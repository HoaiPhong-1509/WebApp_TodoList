import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { ArrowLeft, LogOut, MessageCircle, Search, Send, Trash2, Users, UserPlus, X } from "lucide-react";
import api from "@/lib/axios";
import { getAuthToken } from "@/lib/authToken";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SOCKET_BASE_URL =
  import.meta.env.MODE === "development" ? "http://localhost:5001" : window.location.origin;

const MAX_LOCAL_MESSAGES = 200;

const formatTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatConversationPreview = (conversation) => {
  const preview = conversation.lastMessage?.content;
  if (!preview) {
    return "Start a new conversation";
  }

  return preview.length > 42 ? `${preview.slice(0, 42)}...` : preview;
};

const toIdString = (value) => (value === null || value === undefined ? "" : String(value));

const ChatPanel = () => {
  const { user } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [unreadByConversation, setUnreadByConversation] = useState({});

  const [draft, setDraft] = useState("");
  const [typingState, setTypingState] = useState({});
  const [presenceByConversation, setPresenceByConversation] = useState({});

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMemberIds, setNewGroupMemberIds] = useState([]);
  const [groupMemberQuery, setGroupMemberQuery] = useState("");
  const [groupMemberResults, setGroupMemberResults] = useState([]);

  const [showAddMembers, setShowAddMembers] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState([]);
  const [addMemberQuery, setAddMemberQuery] = useState("");
  const [addMemberResults, setAddMemberResults] = useState([]);

  const [showConversationListMobile, setShowConversationListMobile] = useState(true);

  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const listEndRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const activeConversationIdRef = useRef(activeConversationId);
  const countedUnreadMessageIdsRef = useRef(new Set());
  const unreadBumpAtByConversationRef = useRef({});

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations]
  );

  const canDissolveGroup = Boolean(activeConversation?.permissions?.canDissolve);
  const canLeaveGroup = Boolean(activeConversation?.permissions?.canLeave);

  const activeMessages = useMemo(
    () => messagesByConversation[activeConversationId] || [],
    [activeConversationId, messagesByConversation]
  );

  const activeTypingLabel = useMemo(() => {
    if (!activeConversationId) {
      return "";
    }

    const users = Object.values(typingState[activeConversationId] || {}).filter(Boolean);
    if (users.length === 0) {
      return "";
    }

    const first = users[0]?.name || "Someone";
    if (users.length === 1) {
      return `${first} is typing...`;
    }

    return `${first} and ${users.length - 1} others are typing...`;
  }, [activeConversationId, typingState]);

  const unreadTotal = useMemo(
    () => Object.values(unreadByConversation).reduce((sum, count) => sum + count, 0),
    [unreadByConversation]
  );

  const availableUsersForGroup = useMemo(() => {
    if (!activeConversation || activeConversation.type !== "group") {
      return addMemberResults;
    }

    const existingIds = new Set(activeConversation.participants.map((participant) => participant.id));
    return addMemberResults.filter((searchUser) => !existingIds.has(searchUser.id));
  }, [activeConversation, addMemberResults]);

  const availableUsersForNewGroup = useMemo(() => {
    const selectedIds = new Set(newGroupMemberIds);
    return groupMemberResults.filter((searchUser) => !selectedIds.has(searchUser.id));
  }, [groupMemberResults, newGroupMemberIds]);

  const upsertConversation = (incomingConversation, shouldMoveToTop = true) => {
    setConversations((prev) => {
      const withoutCurrent = prev.filter((conversation) => conversation.id !== incomingConversation.id);
      if (shouldMoveToTop) {
        return [incomingConversation, ...withoutCurrent];
      }

      return [...withoutCurrent, incomingConversation].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
  };

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const loadConversations = async () => {
      try {
        const res = await api.get("/chat/conversations");
        const nextConversations = res.data.conversations || [];
        setConversations(nextConversations);

        if (nextConversations.length > 0) {
          setActiveConversationId((prev) => prev || nextConversations[0].id);
        }
      } catch (error) {
        console.error("Unable to load conversations:", error);
      }
    };

    loadConversations();
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      return;
    }

    const socket = io(SOCKET_BASE_URL, {
      auth: { token },
      transports: ["websocket"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("chat:presence", ({ conversationId, onlineCount }) => {
      if (!conversationId) {
        return;
      }

      setPresenceByConversation((prev) => ({
        ...prev,
        [conversationId]: onlineCount || 0,
      }));
    });

    socket.on("chat:typing", ({ conversationId, user: typingUser, isTyping }) => {
      if (!conversationId || !typingUser?.id || typingUser.id === user.id) {
        return;
      }

      setTypingState((prev) => ({
        ...prev,
        [conversationId]: {
          ...(prev[conversationId] || {}),
          [typingUser.id]: isTyping
            ? {
                id: typingUser.id,
                name: typingUser.name,
              }
            : null,
        },
      }));
    });

    socket.on("chat:message", (incomingMessage) => {
      const conversationId = incomingMessage?.conversationId;
      if (!conversationId) {
        return;
      }

      const isOwnMessage = toIdString(incomingMessage.sender?.id) === toIdString(user?.id);
      const isReadingConversation = isOpenRef.current && activeConversationIdRef.current === conversationId;
      const messageId = toIdString(incomingMessage?.id);

      if (!isOwnMessage && !isReadingConversation && messageId && !countedUnreadMessageIdsRef.current.has(messageId)) {
        countedUnreadMessageIdsRef.current.add(messageId);

        if (countedUnreadMessageIdsRef.current.size > 3000) {
          countedUnreadMessageIdsRef.current.clear();
        }

        setUnreadByConversation((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || 0) + 1,
        }));
      }

      setMessagesByConversation((prev) => {
        const current = prev[conversationId] || [];
        if (current.some((message) => message.id === incomingMessage.id)) {
          return prev;
        }

        const nextMessages = [...current, incomingMessage];
        return {
          ...prev,
          [conversationId]:
            nextMessages.length > MAX_LOCAL_MESSAGES
              ? nextMessages.slice(nextMessages.length - MAX_LOCAL_MESSAGES)
              : nextMessages,
        };
      });

      setConversations((prev) => {
        const found = prev.find((conversation) => conversation.id === conversationId);
        if (!found) {
          return prev;
        }

        const updatedConversation = {
          ...found,
          lastMessage: {
            content: incomingMessage.content,
            sender: incomingMessage.sender?.id,
            createdAt: incomingMessage.createdAt,
          },
          updatedAt: incomingMessage.createdAt,
        };

        return [updatedConversation, ...prev.filter((conversation) => conversation.id !== conversationId)];
      });
    });

    socket.on("chat:conversation:update", ({ conversation }) => {
      if (!conversation?.id) {
        return;
      }

      setConversations((prev) => {
        const existingConversation = prev.find((item) => item.id === conversation.id);
        const previousLastMessageAt = existingConversation?.lastMessage?.createdAt;
        const nextLastMessageAt = conversation.lastMessage?.createdAt;

        const hasNewLastMessage =
          Boolean(nextLastMessageAt) &&
          (!previousLastMessageAt || new Date(nextLastMessageAt).getTime() > new Date(previousLastMessageAt).getTime());

        const isOwnLastMessage = toIdString(conversation.lastMessage?.sender) === toIdString(user?.id);
        const isReadingConversation = isOpenRef.current && activeConversationIdRef.current === conversation.id;
        const lastUnreadBumpAt = unreadBumpAtByConversationRef.current[conversation.id];
        const shouldBumpUnreadFromUpdate =
          hasNewLastMessage &&
          !isOwnLastMessage &&
          !isReadingConversation &&
          (!lastUnreadBumpAt || new Date(nextLastMessageAt).getTime() > new Date(lastUnreadBumpAt).getTime());

        if (shouldBumpUnreadFromUpdate) {
          unreadBumpAtByConversationRef.current[conversation.id] = nextLastMessageAt;
          setUnreadByConversation((prevUnread) => ({
            ...prevUnread,
            [conversation.id]: (prevUnread[conversation.id] || 0) + 1,
          }));
        }

        const withoutCurrent = prev.filter((item) => item.id !== conversation.id);
        return [conversation, ...withoutCurrent];
      });
    });

    socket.on("chat:conversation:deleted", ({ conversationId }) => {
      if (!conversationId) {
        return;
      }

      setMessagesByConversation((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });

      setPresenceByConversation((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });

      setTypingState((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });

      setUnreadByConversation((prev) => {
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });

      setConversations((prev) => {
        const filtered = prev.filter((conversation) => conversation.id !== conversationId);
        setActiveConversationId((currentActiveId) => {
          if (currentActiveId !== conversationId) {
            return currentActiveId;
          }

          setShowConversationListMobile(true);
          return filtered[0]?.id || null;
        });

        return filtered;
      });
    });

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [user]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    const loadMessages = async () => {
      try {
        const res = await api.get(`/chat/conversations/${activeConversationId}/messages?limit=80`);
        setMessagesByConversation((prev) => ({
          ...prev,
          [activeConversationId]: res.data.messages || [],
        }));
      } catch (error) {
        console.error("Unable to load messages:", error);
      }
    };

    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit("chat:join", { conversationId: activeConversationId });
    }

    loadMessages();
  }, [activeConversationId]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await api.get(`/chat/users?query=${encodeURIComponent(query)}`);
        setSearchResults(res.data.users || []);
      } catch (error) {
        console.error("Unable to search users:", error);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  useEffect(() => {
    if (!showAddMembers) {
      setAddMemberQuery("");
      setAddMemberResults([]);
      setAddMemberIds([]);
      return;
    }

    const query = addMemberQuery.trim();
    if (!query) {
      setAddMemberResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await api.get(`/chat/users?query=${encodeURIComponent(query)}`);
        setAddMemberResults(res.data.users || []);
      } catch (error) {
        console.error("Unable to search users for add members:", error);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [addMemberQuery, showAddMembers]);

  useEffect(() => {
    if (!showCreateGroup) {
      setGroupMemberQuery("");
      setGroupMemberResults([]);
      return;
    }

    const query = groupMemberQuery.trim();
    if (!query) {
      setGroupMemberResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      try {
        const res = await api.get(`/chat/users?query=${encodeURIComponent(query)}`);
        setGroupMemberResults(res.data.users || []);
      } catch (error) {
        console.error("Unable to search users for group creation:", error);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [groupMemberQuery, showCreateGroup]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversationId, activeMessages, activeTypingLabel]);

  useEffect(() => {
    if (!isOpen || !activeConversationId) {
      return;
    }

    setUnreadByConversation((prev) => {
      if (!prev[activeConversationId]) {
        return prev;
      }

      const next = { ...prev };
      delete next[activeConversationId];
      return next;
    });
  }, [isOpen, activeConversationId]);

  const handleOpenConversation = (conversationId) => {
    setActiveConversationId(conversationId);
    setShowAddMembers(false);
    setShowConversationListMobile(false);
  };

  const startDirectChat = async (targetUserId) => {
    try {
      const res = await api.post("/chat/conversations/direct", { userId: targetUserId });
      const conversation = res.data.conversation;
      if (!conversation) {
        return;
      }

      upsertConversation(conversation, true);
      setActiveConversationId(conversation.id);
      setIsOpen(true);
      setShowConversationListMobile(false);
      setSearchQuery("");
      setSearchResults([]);
    } catch (error) {
      console.error("Unable to start direct chat:", error);
    }
  };

  const toggleGroupMember = (memberId) => {
    setNewGroupMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const createGroupConversation = async () => {
    try {
      const res = await api.post("/chat/conversations/group", {
        name: newGroupName,
        memberIds: newGroupMemberIds,
      });

      const conversation = res.data.conversation;
      if (!conversation) {
        return;
      }

      upsertConversation(conversation, true);
      setActiveConversationId(conversation.id);
      setShowCreateGroup(false);
      setNewGroupName("");
      setNewGroupMemberIds([]);
      setGroupMemberQuery("");
      setGroupMemberResults([]);
      setIsOpen(true);
      setShowConversationListMobile(false);
    } catch (error) {
      console.error("Unable to create group conversation:", error);
    }
  };

  const toggleAddMember = (memberId) => {
    setAddMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const addMembersToActiveConversation = async () => {
    if (!activeConversationId || addMemberIds.length === 0) {
      return;
    }

    try {
      const res = await api.post(`/chat/conversations/${activeConversationId}/members`, {
        memberIds: addMemberIds,
      });

      const conversation = res.data.conversation;
      if (!conversation) {
        return;
      }

      upsertConversation(conversation, false);
      setShowAddMembers(false);
      setAddMemberIds([]);
      setAddMemberQuery("");
      setAddMemberResults([]);
    } catch (error) {
      console.error("Unable to add members:", error);
    }
  };

  const emitTyping = (isTyping) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !activeConversationId) {
      return;
    }

    socket.emit("chat:typing", {
      conversationId: activeConversationId,
      isTyping,
    });
  };

  const handleDraftChange = (event) => {
    const nextValue = event.target.value;
    setDraft(nextValue);

    emitTyping(nextValue.trim().length > 0);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      emitTyping(false);
    }, 1000);
  };

  const sendMessage = () => {
    const content = draft.trim();
    if (!content || !activeConversationId) {
      return;
    }

    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    emitTyping(false);

    socket.emit(
      "chat:message",
      {
        conversationId: activeConversationId,
        content,
      },
      (result) => {
        if (!result?.ok) {
          console.error(result?.message || "Unable to send message");
        }
      }
    );

    setDraft("");
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const deleteActiveConversation = async () => {
    if (!activeConversationId) {
      return;
    }

    const shouldDelete = window.confirm(
      activeConversation?.type === "group" && canDissolveGroup
        ? "Dissolve this group for all members? This action cannot be undone."
        : "Delete this conversation for your account?"
    );

    if (!shouldDelete) {
      return;
    }

    try {
      await api.delete(`/chat/conversations/${activeConversationId}`);
    } catch (error) {
      console.error("Unable to delete conversation:", error);
    }
  };

  const leaveActiveGroup = async () => {
    if (!activeConversationId || !canLeaveGroup) {
      return;
    }

    const shouldLeave = window.confirm("Leave this group conversation?");
    if (!shouldLeave) {
      return;
    }

    try {
      await api.post(`/chat/conversations/${activeConversationId}/leave`);
    } catch (error) {
      console.error("Unable to leave group conversation:", error);
    }
  };

  if (!isOpen) {
    return createPortal(
      <div
        style={{
          position: "fixed",
          right: "1.25rem",
          bottom: "1.5rem",
          left: "auto",
          zIndex: 9999,
          transform: "none",
        }}
      >
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="relative inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
        >
          {unreadTotal > 0 ? (
            <span className="absolute -right-2 -top-2 min-w-6 rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          ) : null}
          <MessageCircle className="h-4 w-4" />
          Open Messenger
        </button>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col px-3 py-3 md:px-6 md:py-5">
        <div className="mb-3 flex items-center justify-between rounded-xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <div>
            <h2 className="text-xl font-semibold">Messenger Workspace</h2>
            <p className="text-xs text-muted-foreground">{isConnected ? "Realtime connected" : "Reconnecting..."}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[360px_1fr]">
          <aside
            className={`min-h-0 flex-col rounded-xl border border-border/80 bg-card p-3 shadow-sm ${
              showConversationListMobile ? "flex" : "hidden"
            } md:flex`}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search users"
                className="pl-9"
              />
            </div>

            {searchQuery.trim() ? (
              <div className="mt-2 space-y-2 overflow-y-auto rounded-lg border border-border/70 bg-background-secondary/70 p-2">
                {searchResults.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No user found</p>
                ) : (
                  searchResults.map((resultUser) => (
                    <div
                      key={resultUser.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-card px-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{resultUser.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{resultUser.email}</p>
                      </div>
                      <Button size="xs" variant="outline" onClick={() => startDirectChat(resultUser.id)}>
                        Chat
                      </Button>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => setShowCreateGroup((prev) => !prev)}
              >
                <Users className="mr-2 h-4 w-4" />
                {showCreateGroup ? "Close Group Creator" : "Create Group"}
              </Button>
            </div>

            {showCreateGroup ? (
              <div className="mt-3 rounded-lg border border-border/80 bg-background-secondary/70 p-2">
                <Input
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                />
                <Input
                  className="mt-2"
                  placeholder="Search users to add"
                  value={groupMemberQuery}
                  onChange={(event) => setGroupMemberQuery(event.target.value)}
                />
                <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                  {groupMemberQuery.trim() && availableUsersForNewGroup.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No users match this keyword</p>
                  ) : null}
                  {availableUsersForNewGroup.map((searchUser) => (
                    <label key={`new-group-${searchUser.id}`} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={newGroupMemberIds.includes(searchUser.id)}
                        onChange={() => toggleGroupMember(searchUser.id)}
                      />
                      <span className="truncate">{searchUser.name}</span>
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  className="mt-2 w-full"
                  size="sm"
                  onClick={createGroupConversation}
                  disabled={!newGroupName.trim() || newGroupMemberIds.length < 2}
                >
                  Create Group Conversation
                </Button>
              </div>
            ) : null}

            <div className="mt-4 border-t pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversations</p>
              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1 md:max-h-none md:flex-1">
                {conversations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No conversations yet.</p>
                ) : (
                  conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => handleOpenConversation(conversation.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        conversation.id === activeConversationId
                          ? "border-primary bg-primary/10"
                          : "border-border/70 bg-background hover:bg-background-secondary"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{conversation.title}</p>
                        {conversation.type === "group" ? <Users className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{formatConversationPreview(conversation)}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>

          <section
            className={`min-h-0 flex-col rounded-xl border border-border/80 bg-card shadow-sm ${
              showConversationListMobile ? "hidden" : "flex"
            } md:flex`}
          >
            {!activeConversation ? (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
                Select a user or conversation to start chatting.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="md:hidden"
                      onClick={() => setShowConversationListMobile(true)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold">{activeConversation.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {presenceByConversation[activeConversation.id] || 0} active in this chat
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {activeConversation.type === "group" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddMembers((prev) => !prev)}
                        disabled={!canDissolveGroup}
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">Add Members</span>
                      </Button>
                    ) : null}
                    {canLeaveGroup ? (
                      <Button type="button" variant="outline" size="sm" onClick={leaveActiveGroup}>
                        <LogOut className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">Leave Group</span>
                      </Button>
                    ) : null}
                    <Button type="button" variant="destructive" size="sm" onClick={deleteActiveConversation}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span className="hidden sm:inline">
                        {activeConversation.type === "group" && canDissolveGroup ? "Dissolve Group" : "Delete Chat"}
                      </span>
                    </Button>
                  </div>
                </div>

                {showAddMembers && activeConversation.type === "group" ? (
                  <div className="border-b bg-background-secondary/70 px-4 py-3">
                    <Input
                      placeholder="Search users to add"
                      value={addMemberQuery}
                      onChange={(event) => setAddMemberQuery(event.target.value)}
                    />
                    <div className="max-h-24 space-y-1 overflow-y-auto pt-2">
                      {addMemberQuery.trim() && availableUsersForGroup.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No users match this keyword</p>
                      ) : null}
                      {availableUsersForGroup.map((candidateUser) => (
                        <label key={`add-${candidateUser.id}`} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={addMemberIds.includes(candidateUser.id)}
                            onChange={() => toggleAddMember(candidateUser.id)}
                          />
                          <span className="truncate">{candidateUser.name}</span>
                        </label>
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      onClick={addMembersToActiveConversation}
                      disabled={addMemberIds.length === 0}
                    >
                      Save Members
                    </Button>
                  </div>
                ) : null}

                <div className="flex-1 space-y-2 overflow-y-auto bg-background-secondary/40 px-4 py-3">
                  {activeMessages.map((message) => {
                    const isMine = message.sender?.id === user?.id;

                    return (
                      <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 sm:max-w-[75%] ${
                            isMine
                              ? "bg-primary text-primary-foreground"
                              : "border border-border/70 bg-card text-card-foreground"
                          }`}
                        >
                          {!isMine ? <p className="text-[11px] font-semibold opacity-80">{message.sender?.name}</p> : null}
                          <p className="break-words text-sm">{message.content}</p>
                          <p className="mt-1 text-[10px] opacity-70">{formatTime(message.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}

                  {activeTypingLabel ? <p className="px-1 text-xs text-muted-foreground">{activeTypingLabel}</p> : null}
                  <div ref={listEndRef} />
                </div>

                <div className="border-t px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={draft}
                      onChange={handleDraftChange}
                      onKeyDown={handleComposerKeyDown}
                      placeholder="Type your message"
                    />
                    <Button
                      type="button"
                      size="icon"
                      onClick={sendMessage}
                      disabled={!draft.trim() || !isConnected || !activeConversationId}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ChatPanel;
