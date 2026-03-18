import AddTask from '@/components/AddTask';
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Header } from '@/components/Header';
import StatsAndFilters from '@/components/StatsAndFilters';
import TaskListPagination from '@/components/TaskListPagination';
import DateTimeFilter from '@/components/DateTimeFilter';
import TaskList from '@/components/TaskList';
import Footer from '@/components/Footer';
import ChatPanel from '@/components/ChatPanel';
import { toast } from 'sonner';
import api from '@/lib/axios';
import { visibleTaskLimit } from '@/lib/data';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { BrainCircuit, Check, ChevronsUpDown, Copy, FolderKanban, History, Sparkles, Trash2, Users, X } from 'lucide-react';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const DEFAULT_WORKSPACE_PERMISSIONS = {
  role: null,
  isOwner: false,
  isMember: false,
  canInvite: false,
  canViewMembers: false,
  canCrudTasks: false,
  canRemoveMembers: false,
  canApproveMembers: false,
  canDeleteWorkspace: false,
};

const formatLocalDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatActivityDateTime = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString();
};

const buildActivitySeriesFallback = (tasks) => {
  const days = 7;
  const now = new Date();
  const activityMap = new Map();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(now.getDate() - i);
    const key = formatLocalDateKey(d);
    activityMap.set(key, {
      key,
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      createdCount: 0,
      completedCount: 0,
      netFlow: 0,
    });
  }

  tasks.forEach((task) => {
    if (task?.createdAt) {
      const createdKey = formatLocalDateKey(new Date(task.createdAt));
      if (activityMap.has(createdKey)) {
        activityMap.get(createdKey).createdCount += 1;
      }
    }

    if (task?.completedAt) {
      const completedKey = formatLocalDateKey(new Date(task.completedAt));
      if (activityMap.has(completedKey)) {
        activityMap.get(completedKey).completedCount += 1;
      }
    }
  });

  return Array.from(activityMap.values()).map((item) => ({
    ...item,
    netFlow: item.completedCount - item.createdCount,
  }));
};

const buildAiInsights = ({ total, todo, inProgress, completed, tasks }) => {
  if (!total) {
    return [
      'No task data yet. Create 3-5 concrete tasks to let AI analyze workload trends.',
      'Use action verbs in task titles to improve recommendation quality, for example: Draft API docs.',
      'Set one measurable completion criterion per task to reduce context switching and decision fatigue.',
    ];
  }

  const completionRate = Math.round((completed / total) * 100);
  const inProgressRate = Math.round((inProgress / total) * 100);
  const staleTodo = tasks.filter((task) => {
    if (task.status !== 'todo' || !task.createdAt) {
      return false;
    }
    const ageMs = Date.now() - new Date(task.createdAt).getTime();
    return ageMs > 1000 * 60 * 60 * 24 * 3;
  }).length;

  const insights = [];

  if (completionRate >= 55) {
    insights.push(`Strong execution rhythm: ${completionRate}% tasks completed. Keep batching similar tasks in 60-90 minute focus blocks.`);
  } else {
    insights.push(`Completion rate is ${completionRate}%. Reduce active scope to raise throughput: pick top 3 priorities each day.`);
  }

  if (todo > completed) {
    insights.push(`Backlog pressure detected: ${todo} To Do vs ${completed} Completed. Schedule one daily backlog-trim session.`);
  }

  if (inProgressRate > 40) {
    insights.push(`In Progress load is high (${inProgressRate}%). Limiting WIP to 2-3 tasks can cut switching costs and improve finishing speed.`);
  } else {
    insights.push(`In Progress distribution is healthy (${inProgressRate}%). Keep this balance to maintain flow efficiency.`);
  }

  if (staleTodo > 0) {
    insights.push(`${staleTodo} To Do tasks are older than 3 days. Break each into a smaller first step to reduce procrastination friction.`);
  } else {
    insights.push('Backlog freshness is good. Continue pruning low-impact items weekly to preserve decision clarity.');
  }

  return insights;
};

const IMPACT_STYLES = {
  high: 'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-emerald-100 text-emerald-700',
};

const ActivityLineChart = ({ series }) => {
  const width = 460;
  const height = 220;
  const padding = 34;
  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short' });
  const todayIndex = Math.max(0, weekdayLabels.indexOf(todayLabel));
  const totalsByWeekday = series.reduce((acc, item) => {
    const label = item.label;
    if (!acc[label]) {
      acc[label] = { createdCount: 0, completedCount: 0 };
    }
    acc[label].createdCount += item.createdCount || 0;
    acc[label].completedCount += item.completedCount || 0;
    return acc;
  }, {});

  const displaySeries = weekdayLabels.map((label, idx) => ({
    key: label,
    label,
    createdCount: totalsByWeekday[label]?.createdCount || 0,
    completedCount: totalsByWeekday[label]?.completedCount || 0,
    isFutureDay: idx > todayIndex,
  }));

  const visibleSeries = displaySeries.map((item) => ({
    ...item,
    visibleCreated: item.isFutureDay ? null : item.createdCount,
    visibleCompleted: item.isFutureDay ? null : item.completedCount,
  }));

  const maxValue = Math.max(
    ...visibleSeries.map((item) => Math.max(item.visibleCreated || 0, item.visibleCompleted || 0)),
    1
  );
  const yTickPercents = [0, 0.25, 0.5, 0.75, 1];

  const mapPoint = (item, idx) => {
    const x = padding + (idx * (width - padding * 2)) / (displaySeries.length - 1 || 1);
    return { ...item, x };
  };

  const valueToY = (value) => height - padding - ((value || 0) / maxValue) * (height - padding * 2);
  const points = visibleSeries.map((item, idx) => mapPoint(item, idx));

  const createdPoints = points
    .filter((point) => point.visibleCreated !== null)
    .map((point) => ({ ...point, y: valueToY(point.visibleCreated) }));

  const completedPoints = points
    .filter((point) => point.visibleCompleted !== null)
    .map((point) => ({ ...point, y: valueToY(point.visibleCompleted) }));

  const createdPolyline = createdPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const completedPolyline = completedPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPath = completedPoints.length > 1
    ? `${completedPolyline} ${completedPoints[completedPoints.length - 1].x},${height - padding} ${completedPoints[0].x},${height - padding}`
    : '';

  return (
    <div className='w-full space-y-3'>
      <div className='flex flex-wrap items-center gap-4 text-xs text-slate-600'>
        <div className='inline-flex items-center gap-2'>
          <span className='size-2.5 rounded-full bg-violet-400' />
          Created
        </div>
        <div className='inline-flex items-center gap-2'>
          <span className='size-2.5 rounded-full bg-primary' />
          Completed
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className='h-56 w-full rounded-xl'
        role='img'
        aria-label='User activity line chart'
      >
        <defs>
          <linearGradient id='activityLineGradient' x1='0%' y1='0%' x2='100%' y2='0%'>
            <stop offset='0%' stopColor='#c4b5fd' />
            <stop offset='100%' stopColor='#8b5cf6' />
          </linearGradient>
          <linearGradient id='activityCompletionGradient' x1='0%' y1='0%' x2='100%' y2='0%'>
            <stop offset='0%' stopColor='#7c3aed' />
            <stop offset='100%' stopColor='#5b21b6' />
          </linearGradient>
          <linearGradient id='activityAreaGradient' x1='0%' y1='0%' x2='0%' y2='100%'>
            <stop offset='0%' stopColor='#7c3aed' stopOpacity='0.28' />
            <stop offset='100%' stopColor='#7c3aed' stopOpacity='0.02' />
          </linearGradient>
        </defs>

        <rect x='0' y='0' width={width} height={height} rx='16' fill='transparent' />

        {yTickPercents.map((tick) => (
          <line
            key={tick}
            x1={padding}
            y1={padding + (height - padding * 2) * tick}
            x2={width - padding}
            y2={padding + (height - padding * 2) * tick}
            stroke='#e9d5ff'
            strokeDasharray='5 5'
            strokeWidth='1'
          />
        ))}

        {yTickPercents.map((tick) => {
          const tickValue = Math.round(maxValue * (1 - tick));
          return (
            <text
              key={`label-${tick}`}
              x={padding - 8}
              y={padding + (height - padding * 2) * tick + 4}
              textAnchor='end'
              fontSize='10'
              fill='#64748b'
            >
              {tickValue}
            </text>
          );
        })}

        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke='#94a3b8' strokeWidth='1.2' />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke='#cbd5e1' strokeWidth='1' />

        {areaPath && <polygon fill='url(#activityAreaGradient)' points={areaPath} />}

        <polyline
          fill='none'
          stroke='url(#activityLineGradient)'
          strokeWidth='2.5'
          strokeLinecap='round'
          strokeLinejoin='round'
          points={createdPolyline}
        />

        <polyline
          fill='none'
          stroke='url(#activityCompletionGradient)'
          strokeWidth='3'
          strokeLinecap='round'
          strokeLinejoin='round'
          points={completedPolyline}
        />

        {createdPoints.map((point) => (
          <g key={`created-${point.key}`}>
            <circle cx={point.x} cy={point.y} r='3.5' fill='#a78bfa' />
          </g>
        ))}

        {points.map((point) => (
          <text key={`axis-${point.key}`} x={point.x} y={height - 8} textAnchor='middle' fontSize='11' fill='#64748b'>
            {point.label}
          </text>
        ))}

        {completedPoints.map((point) => (
          <g key={`completed-${point.key}`}>
            <circle cx={point.x} cy={point.y} r='4' fill='#6d28d9' />
          </g>
        ))}
      </svg>
    </div>
  );
};

const HomePage = () => {
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [taskBuffer, setTaskBuffer] = useState([]);
  const [todoTaskCount, setTodoTaskCount] = useState(0);
  const [inProgressTaskCount, setInProgressTaskCount] = useState(0);
  const [completedTaskCount, setCompletedTaskCount] = useState(0);
  const [userTodoTaskCount, setUserTodoTaskCount] = useState(0);
  const [userInProgressTaskCount, setUserInProgressTaskCount] = useState(0);
  const [userCompletedTaskCount, setUserCompletedTaskCount] = useState(0);
  const [userTotalTaskCount, setUserTotalTaskCount] = useState(0);
  const [userActivitySeries, setUserActivitySeries] = useState([]);
  const [aiAdvisor, setAiAdvisor] = useState(null);
  const [filter, setFilter] = useState('all');
  const [dateQuery, setDateQuery] = useState('today');
  const [page, setPage] = useState(1);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceResults, setWorkspaceResults] = useState([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [workspacePermissions, setWorkspacePermissions] = useState(DEFAULT_WORKSPACE_PERMISSIONS);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isWorkspaceComboboxOpen, setIsWorkspaceComboboxOpen] = useState(false);
  const [isWorkspaceCrudOpen, setIsWorkspaceCrudOpen] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [isSubmittingInviteJoin, setIsSubmittingInviteJoin] = useState(false);
  const [workspaceInviteCode, setWorkspaceInviteCode] = useState('');
  const [isInviteCodeLoading, setIsInviteCodeLoading] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [workspacePendingMembers, setWorkspacePendingMembers] = useState([]);
  const [workspaceOwnerId, setWorkspaceOwnerId] = useState('');
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [isWorkspaceDeleting, setIsWorkspaceDeleting] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [workspaceActivities, setWorkspaceActivities] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [workspaceNotifications, setWorkspaceNotifications] = useState([]);
  const [workspaceNotificationCount, setWorkspaceNotificationCount] = useState(0);
  const [isMarkingNotificationsRead, setIsMarkingNotificationsRead] = useState(false);

  const fetchTasks = useCallback(async (workspaceId = selectedWorkspaceId) => {
    if (!workspaceId) {
      setTaskBuffer([]);
      setTodoTaskCount(0);
      setInProgressTaskCount(0);
      setCompletedTaskCount(0);
      setUserTodoTaskCount(0);
      setUserInProgressTaskCount(0);
      setUserCompletedTaskCount(0);
      setUserTotalTaskCount(0);
      setUserActivitySeries([]);
      setAiAdvisor(null);
      setWorkspacePermissions(DEFAULT_WORKSPACE_PERMISSIONS);
      setWorkspaceInviteCode('');
      return;
    }

    try {
      const res = await api.get('/tasks', {
        params: {
          filter: dateQuery,
          workspaceId,
        },
      });
      setTaskBuffer(res.data.tasks);
      setTodoTaskCount(res.data.todoCount);
      setInProgressTaskCount(res.data.inProgressCount);
      setCompletedTaskCount(res.data.completedCount);
      setUserTodoTaskCount(res.data.userSummary?.todoCount || 0);
      setUserInProgressTaskCount(res.data.userSummary?.inProgressCount || 0);
      setUserCompletedTaskCount(res.data.userSummary?.completedCount || 0);
      setUserTotalTaskCount(res.data.userSummary?.totalCount || 0);
      setUserActivitySeries(res.data.userActivitySeries || []);
      setAiAdvisor(res.data.aiAdvisor || null);
      setWorkspacePermissions(res.data.workspace?.permissions || DEFAULT_WORKSPACE_PERMISSIONS);

    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error('Failed to fetch tasks. Please try again later.');
    }
  }, [dateQuery, selectedWorkspaceId]);

  const fetchWorkspaces = useCallback(async (queryText = '', keepSelection = true) => {
    setIsWorkspaceLoading(true);
    try {
      const res = await api.get('/workspaces', {
        params: {
          q: queryText,
        },
      });

      const nextResults = res.data.workspaces || [];
      setWorkspaceResults(nextResults);

      if (!queryText) {
        setWorkspaces(nextResults);

        if (!keepSelection) {
          const firstId = nextResults[0]?._id || '';
          setSelectedWorkspaceId(firstId);
          if (firstId) {
            await fetchTasks(firstId);
          }
          return;
        }

        if (!selectedWorkspaceId && nextResults[0]?._id) {
          setSelectedWorkspaceId(nextResults[0]._id);
          await fetchTasks(nextResults[0]._id);
        }
      }
    } catch (error) {
      console.error('Error fetching workspaces:', error);
      toast.error('Failed to load workspaces.');
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, [fetchTasks, selectedWorkspaceId]);

  const loadWorkspaceNotifications = useCallback(async () => {
    try {
      const res = await api.get('/workspaces/notifications/summary', {
        params: {
          sinceHours: 48,
          limit: 10,
        },
      });

      setWorkspaceNotifications(res.data?.workspaceSummaries || []);
      setWorkspaceNotificationCount(Number(res.data?.totalNotificationCount || 0));
    } catch (error) {
      console.error('Error loading workspace notifications:', error);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces('', true);
  }, [fetchWorkspaces]);

  useEffect(() => {
    loadWorkspaceNotifications();

    const timer = setInterval(() => {
      loadWorkspaceNotifications();
    }, 30000);

    return () => clearInterval(timer);
  }, [loadWorkspaceNotifications]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    fetchTasks(selectedWorkspaceId);
  }, [dateQuery, selectedWorkspaceId, fetchTasks]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchWorkspaces(workspaceQuery, true);
    }, 180);

    return () => clearTimeout(timer);
  }, [workspaceQuery, fetchWorkspaces]);

  useEffect(() => {
    setPage(1);
  }, [filter, dateQuery, selectedWorkspaceId]);

  const handleTaskChanged = () => {
    fetchTasks();
  };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  const markAllWorkspaceNotificationsRead = async () => {
    if (workspaceNotificationCount === 0 || isMarkingNotificationsRead) {
      return;
    }

    try {
      setIsMarkingNotificationsRead(true);
      await api.post('/workspaces/notifications/mark-all-read');
      setWorkspaceNotifications([]);
      setWorkspaceNotificationCount(0);
      toast.success('Đã đánh dấu tất cả thông báo là đã xem.');
    } catch (error) {
      console.error('Error marking notifications as read:', error);
      toast.error(error.response?.data?.message || 'Không thể cập nhật trạng thái thông báo.');
    } finally {
      setIsMarkingNotificationsRead(false);
    }
  };

  const handleNext = () => {
    if (page < totalPages){
      setPage(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (page > 1){
      setPage(prev => prev - 1);
    }
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
  };

  const filteredTasks = taskBuffer.filter(task => {
    switch (filter) {
      case 'todo':
        return task.status === 'todo';
      case 'in_progress':
        return task.status === 'in_progress';
      case 'completed':
        return task.status === 'completed';
      default:
        return true;
    }
  });

  const visibleTasks = filteredTasks.slice(
    (page - 1) * visibleTaskLimit,
    page * visibleTaskLimit
  );

  const totalPages = Math.ceil(filteredTasks.length / visibleTaskLimit);
  const totalTaskCount = todoTaskCount + inProgressTaskCount + completedTaskCount;
  const activitySeries = userActivitySeries.length > 0 ? userActivitySeries : buildActivitySeriesFallback(taskBuffer);
  const activityCreatedTotal = activitySeries.reduce((sum, item) => sum + item.createdCount, 0);
  const activityCompletedTotal = activitySeries.reduce((sum, item) => sum + item.completedCount, 0);
  const activityCompletionRate = activityCreatedTotal > 0
    ? Math.round((activityCompletedTotal / activityCreatedTotal) * 100)
    : (activityCompletedTotal > 0 ? 100 : 0);
  const aiInsights = buildAiInsights({
    total: totalTaskCount,
    todo: todoTaskCount,
    inProgress: inProgressTaskCount,
    completed: completedTaskCount,
    tasks: taskBuffer,
  });
  const aiRecommendations = aiAdvisor?.recommendations?.length
    ? aiAdvisor.recommendations
    : aiInsights.map((insight, index) => ({
      id: `fallback-${index}`,
      title: `Insight ${index + 1}`,
      advice: insight,
      reason: 'Fallback recommendation generated on client while backend advice is unavailable.',
      impact: 'low',
    }));
  const aiCompletionRate = aiAdvisor?.metrics?.completionRate ?? activityCompletionRate;
  const aiDominantTopic = aiAdvisor?.metrics?.dominantTopic || 'General';
  const aiStaleCount = (aiAdvisor?.metrics?.staleTodoCount || 0) + (aiAdvisor?.metrics?.staleInProgressCount || 0);
  const aiProviderLabel = aiAdvisor?.provider === 'groq' ? 'Groq' : 'Rule-based fallback';
  const selectedWorkspace = workspaces.find((workspace) => workspace._id === selectedWorkspaceId)
    || workspaceResults.find((workspace) => workspace._id === selectedWorkspaceId)
    || workspaces[0];
  const notificationCount = Math.min(workspaceNotificationCount, 99);

  useEffect(() => {
    if (selectedWorkspace?.permissions) {
      setWorkspacePermissions(selectedWorkspace.permissions);
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const createWorkspace = async () => {
    const normalized = newWorkspaceName.trim();
    if (!normalized) {
      toast.error('Enter workspace name to create.');
      return;
    }

    try {
      const res = await api.post('/workspaces', { name: normalized });
      const workspace = res.data.workspace;
      setWorkspaceQuery('');
      setNewWorkspaceName('');
      setSelectedWorkspaceId(workspace._id);
      await api.patch(`/workspaces/${workspace._id}/activate`);
      await fetchWorkspaces('', true);
      await fetchTasks(workspace._id);
      toast.success('Workspace created');
    } catch (error) {
      console.error('Error creating workspace:', error);
      const message = error.response?.data?.message || 'Failed to create workspace.';
      toast.error(message);
    }
  };

  const selectWorkspace = async (workspace) => {
    try {
      setSelectedWorkspaceId(workspace._id);
      setWorkspaceQuery('');
      setIsWorkspaceComboboxOpen(false);
      setWorkspaceInviteCode('');
      await api.patch(`/workspaces/${workspace._id}/activate`);
      await fetchWorkspaces('', true);
      await fetchTasks(workspace._id);
    } catch (error) {
      console.error('Error selecting workspace:', error);
      toast.error('Failed to select workspace.');
    }
  };

  const requestJoinWorkspace = async () => {
    const normalizedCode = inviteCodeInput.trim().toUpperCase();
    if (!normalizedCode) {
      toast.error('Please enter an invite code.');
      return;
    }

    try {
      setIsSubmittingInviteJoin(true);
      await api.post('/workspaces/join-by-code', { inviteCode: normalizedCode });
      setInviteCodeInput('');
      await fetchWorkspaces('', true);
      toast.success('Join request sent. Please wait for owner approval.');
    } catch (error) {
      console.error('Error joining workspace:', error);
      toast.error(error.response?.data?.message || 'Failed to send join request.');
    } finally {
      setIsSubmittingInviteJoin(false);
    }
  };

  const fetchWorkspaceInviteCode = async () => {
    if (!selectedWorkspaceId) {
      toast.error('Please select a workspace first.');
      return;
    }

    try {
      setIsInviteCodeLoading(true);
      const res = await api.post(`/workspaces/${selectedWorkspaceId}/invite-code`);
      setWorkspaceInviteCode(res.data?.inviteCode || '');
      toast.success('Invite code loaded.');
    } catch (error) {
      console.error('Error loading invite code:', error);
      toast.error(error.response?.data?.message || 'Failed to load invite code.');
    } finally {
      setIsInviteCodeLoading(false);
    }
  };

  const copyInviteCode = async () => {
    if (!workspaceInviteCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(workspaceInviteCode);
      toast.success('Invite code copied.');
    } catch {
      toast.error('Unable to copy invite code.');
    }
  };

  const loadWorkspaceMembers = async () => {
    if (!selectedWorkspaceId) {
      return;
    }

    try {
      setIsMembersLoading(true);
      const res = await api.get(`/workspaces/${selectedWorkspaceId}/members`);
      setWorkspaceMembers(res.data?.members || []);
      setWorkspacePendingMembers(res.data?.pendingMembers || []);
      setWorkspaceOwnerId(res.data?.ownerId || '');
    } catch (error) {
      console.error('Error loading workspace members:', error);
      toast.error(error.response?.data?.message || 'Failed to load workspace members.');
    } finally {
      setIsMembersLoading(false);
    }
  };

  const openMembersModal = async () => {
    setIsMembersModalOpen(true);
    await loadWorkspaceMembers();
  };

  const approvePendingMember = async (userId) => {
    try {
      await api.post(`/workspaces/${selectedWorkspaceId}/pending/${userId}/approve`);
      toast.success('Member approved.');
      await Promise.all([loadWorkspaceMembers(), fetchWorkspaces('', true)]);
    } catch (error) {
      console.error('Error approving member:', error);
      toast.error(error.response?.data?.message || 'Failed to approve member.');
    }
  };

  const rejectPendingMember = async (userId) => {
    try {
      await api.post(`/workspaces/${selectedWorkspaceId}/pending/${userId}/reject`);
      toast.success('Join request rejected.');
      await loadWorkspaceMembers();
    } catch (error) {
      console.error('Error rejecting member:', error);
      toast.error(error.response?.data?.message || 'Failed to reject request.');
    }
  };

  const removeMember = async (userId) => {
    try {
      await api.delete(`/workspaces/${selectedWorkspaceId}/members/${userId}`);
      toast.success('Member removed.');
      await Promise.all([loadWorkspaceMembers(), fetchWorkspaces('', true)]);
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error(error.response?.data?.message || 'Failed to remove member.');
    }
  };

  const deleteCurrentWorkspace = async () => {
    if (!selectedWorkspaceId || !workspacePermissions.canDeleteWorkspace) {
      return;
    }

    const shouldDelete = window.confirm('Delete this workspace and all its tasks? This action cannot be undone.');
    if (!shouldDelete) {
      return;
    }

    try {
      setIsWorkspaceDeleting(true);
      await api.delete(`/workspaces/${selectedWorkspaceId}`);
      setIsWorkspaceCrudOpen(false);
      setIsMembersModalOpen(false);
      setWorkspaceInviteCode('');
      await fetchWorkspaces('', false);
      toast.success('Workspace deleted.');
    } catch (error) {
      console.error('Error deleting workspace:', error);
      toast.error(error.response?.data?.message || 'Failed to delete workspace.');
    } finally {
      setIsWorkspaceDeleting(false);
    }
  };

  const loadWorkspaceHistory = async () => {
    if (!selectedWorkspaceId) {
      return;
    }

    try {
      setIsHistoryLoading(true);
      const res = await api.get(`/workspaces/${selectedWorkspaceId}/activities`, {
        params: { limit: 80 },
      });
      setWorkspaceActivities(res.data?.activities || []);
    } catch (error) {
      console.error('Error loading workspace history:', error);
      toast.error(error.response?.data?.message || 'Failed to load workspace history.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const openHistoryModal = async () => {
    setIsHistoryModalOpen(true);
    await loadWorkspaceHistory();
  };

  const handleChangePassword = async ({ currentPassword, newPassword }) => {
    const res = await changePassword({ currentPassword, newPassword });
    if (res?.message) {
      toast.success(res.message);
    }
    return res;
  };

  return (
    <div className='relative min-h-screen w-full overflow-hidden bg-slate-50'>
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background: 'radial-gradient(125% 125% at 50% 90%, #fff 40%, #7c3aed 100%)',
        }}
      />

      <div className='relative z-10 mx-auto w-full max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:px-8'>
        <Header
          appName='Task Management App'
          user={user}
          userName={user?.name || user?.email || 'User'}
          onLogout={handleLogout}
          onChangePassword={handleChangePassword}
          notificationCount={notificationCount}
          workspaceName={selectedWorkspace?.name}
          workspaceNotifications={workspaceNotifications}
          onMarkAllNotificationsRead={markAllWorkspaceNotificationsRead}
          isMarkingNotificationsRead={isMarkingNotificationsRead}
        />

        <div className='mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3'>
          <div className='space-y-6 lg:col-span-2'>
            <Card className='border-0 bg-transparent shadow-none'>
              <CardHeader className='space-y-2'>
                <CardTitle className='flex items-center gap-2 text-2xl'>
                  <FolderKanban className='size-6 text-primary' />
                  Workspace Hub
                </CardTitle>
                <CardDescription>
                  Search your workspace, open it, and all tasks will be stored by workspace.
                </CardDescription>
              </CardHeader>

              <CardContent className='space-y-4'>
                <div className='grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(240px,1.2fr)_auto] lg:items-center'>
                  <Popover
                    open={isWorkspaceComboboxOpen}
                    onOpenChange={(nextOpen) => {
                      setIsWorkspaceComboboxOpen(nextOpen);
                      if (!nextOpen) {
                        setWorkspaceQuery('');
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant='outline'
                        role='combobox'
                        aria-expanded={isWorkspaceComboboxOpen}
                        className='h-11 w-full cursor-pointer justify-between border-violet-200 bg-white text-left font-normal hover:bg-violet-50'
                      >
                        <span className='truncate'>
                          {selectedWorkspace?.name || 'Select workspace...'}
                        </span>
                        <ChevronsUpDown className='size-4 shrink-0 opacity-60' />
                      </Button>
                    </PopoverTrigger>

                    <PopoverContent className='w-[var(--radix-popover-trigger-width)] p-0' align='start'>
                      <Command shouldFilter={false}>
                        <CommandInput
                          value={workspaceQuery}
                          onValueChange={setWorkspaceQuery}
                          placeholder='Search workspace...'
                        />
                        <CommandList>
                          {isWorkspaceLoading && (
                            <p className='px-3 py-2 text-sm text-slate-500'>Searching workspace...</p>
                          )}

                          {!isWorkspaceLoading && workspaceResults.length === 0 && (
                            <CommandEmpty>No workspace matched your keyword.</CommandEmpty>
                          )}

                          {!isWorkspaceLoading && workspaceResults.length > 0 && (
                            <CommandGroup>
                              {workspaceResults.map((workspace) => (
                                <CommandItem
                                  key={workspace._id}
                                  value={workspace.name}
                                  onSelect={() => selectWorkspace(workspace)}
                                >
                                  <Check
                                    className={cn(
                                      'mr-1 size-4 text-primary',
                                      workspace._id === selectedWorkspaceId ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  <span className='flex-1 truncate'>{workspace.name}</span>
                                  {workspace.isDefault && (
                                    <Badge variant='secondary' className='border-0 bg-primary/15 text-primary'>Default</Badge>
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <div className='flex w-full flex-col gap-3 sm:flex-row sm:items-center'>
                    <Input
                      placeholder='Enter workspace name...'
                      value={newWorkspaceName}
                      onChange={(event) => setNewWorkspaceName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          createWorkspace();
                        }
                      }}
                      className='h-10 bg-white sm:max-w-xs'
                    />
                    <Button
                      variant='outline'
                      className='h-10 cursor-pointer border-primary bg-white text-primary hover:bg-primary/10 sm:w-auto'
                      onClick={createWorkspace}
                    >
                      Create Workspace
                    </Button>
                  </div>
                </div>

                <div className='rounded-xl border border-violet-200/70 bg-white/70 p-4 backdrop-blur-sm'>
                  <p className='text-sm font-semibold text-slate-800'>Join Workspace By Invite Code</p>
                  <p className='mt-1 text-xs text-slate-500'>Paste invite code to send join request. Owner approval is required.</p>
                  <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
                    <Input
                      value={inviteCodeInput}
                      onChange={(event) => setInviteCodeInput(event.target.value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          requestJoinWorkspace();
                        }
                      }}
                      placeholder='e.g. 7K2M9QXH'
                      className='h-10 bg-white sm:max-w-xs'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      className='h-10 cursor-pointer border-primary bg-white text-primary hover:bg-primary/10'
                      disabled={isSubmittingInviteJoin}
                      onClick={requestJoinWorkspace}
                    >
                      {isSubmittingInviteJoin ? 'Sending...' : 'Send Join Request'}
                    </Button>
                  </div>
                </div>

                <div className='rounded-xl bg-white/45 p-4 backdrop-blur-sm ring-1 ring-violet-200/70 transition hover:bg-white/60 hover:ring-violet-400/80'>
                  <button
                    type='button'
                    onClick={() => selectedWorkspace && setIsWorkspaceCrudOpen(true)}
                    disabled={!selectedWorkspace}
                    className='w-full cursor-pointer rounded-lg text-left transition hover:bg-violet-50/70 disabled:cursor-not-allowed disabled:opacity-70'
                  >
                    <p className='text-sm font-semibold text-slate-700'>Current Workspace</p>
                    <p className='text-lg font-bold text-slate-900'>{selectedWorkspace?.name || 'No workspace selected'}</p>
                    {selectedWorkspace && (
                      <p className='text-xs text-slate-500'>
                        Role: {workspacePermissions.role || 'member'} | Members: {selectedWorkspace.memberCount || 1} | Pending: {selectedWorkspace.pendingCount || 0}
                      </p>
                    )}
                    <p className='text-xs text-slate-500'>
                      {selectedWorkspace ? 'Click to open task CRUD window for this workspace.' : 'Pick or create a workspace to start.'}
                    </p>
                  </button>
                </div>

                <div className='space-y-5 rounded-xl bg-transparent p-4'>
                  <ActivityLineChart series={activitySeries} />

                  <p className='text-xs text-slate-600'>
                    Activity data is based on your account in the selected workspace (last 7 days).
                  </p>

                  <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                    <div className='rounded-lg border border-violet-200/70 bg-white/80 p-3'>
                      <p className='text-xs text-slate-500'>Tasks created</p>
                      <p className='text-lg font-bold text-slate-900'>{activityCreatedTotal}</p>
                    </div>

                    <div className='rounded-lg border border-violet-200/70 bg-white/80 p-3'>
                      <p className='text-xs text-slate-500'>Tasks completed</p>
                      <p className='text-lg font-bold text-slate-900'>{activityCompletedTotal}</p>
                    </div>

                    <div className='rounded-lg border border-violet-200/70 bg-white/80 p-3'>
                      <p className='text-xs text-slate-500'>Completion rate</p>
                      <p className='text-lg font-bold text-slate-900'>{activityCompletionRate}%</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className='space-y-6'>
            <Card className='border-0 bg-white/30 shadow-custom-lg backdrop-blur-sm'>
              <CardHeader>
                <CardTitle className='text-xl'>Workflow Snapshot</CardTitle>
                <CardDescription>Task totals across all process stages and workspaces</CardDescription>
              </CardHeader>
              <CardContent className='grid grid-cols-2 gap-3'>
                {[
                  { key: 'todo', color: 'bg-violet-100 text-violet-800', value: userTodoTaskCount },
                  { key: 'in_progress', color: 'bg-purple-100 text-purple-800', value: userInProgressTaskCount },
                  { key: 'completed', color: 'bg-fuchsia-100 text-fuchsia-800', value: userCompletedTaskCount },
                  { key: 'all', label: 'Total', color: 'bg-indigo-100 text-indigo-800', value: userTotalTaskCount },
                ].map((item) => (
                  <div key={item.key} className='rounded-xl border border-slate-200 bg-white p-3'>
                    <Badge className={`${item.color} border-0`}>{item.label || STATUS_LABELS[item.key]}</Badge>
                    <p className='mt-2 text-2xl font-extrabold text-slate-900'>{item.value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className='border-0 bg-white/30 shadow-custom-lg backdrop-blur-sm'>
              <CardHeader className='space-y-2'>
                <CardTitle className='flex items-center gap-2 text-xl'>
                  <BrainCircuit className='size-5 text-primary' />
                  AI Work Science Advisor
                </CardTitle>
                <CardDescription>
                  Khuyến nghị được tạo từ dữ liệu task trên tất cả workspace (7 ngày gần nhất).
                </CardDescription>
                <Badge className='w-fit border-0 bg-slate-200 text-slate-700'>Source: {aiProviderLabel}</Badge>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='grid grid-cols-3 gap-2 text-center'>
                  <div className='rounded-lg border border-violet-200/70 bg-white/80 p-2'>
                    <p className='text-[11px] text-slate-500'>Completion</p>
                    <p className='text-lg font-bold text-slate-900'>{aiCompletionRate}%</p>
                  </div>
                  <div className='rounded-lg border border-violet-200/70 bg-white/80 p-2'>
                    <p className='text-[11px] text-slate-500'>Dominant topic</p>
                    <p className='text-sm font-bold text-slate-900'>{aiDominantTopic}</p>
                  </div>
                  <div className='rounded-lg border border-violet-200/70 bg-white/80 p-2'>
                    <p className='text-[11px] text-slate-500'>Stale tasks</p>
                    <p className='text-lg font-bold text-slate-900'>{aiStaleCount}</p>
                  </div>
                </div>

                {aiRecommendations.map((item, index) => (
                  <div
                    key={item.id || index}
                    className='rounded-xl border border-primary/20 bg-transparent p-3 text-sm text-slate-700'
                  >
                    <div className='mb-2 flex items-center justify-between gap-2 text-primary'>
                      <div className='flex items-center gap-2'>
                        <Sparkles className='size-4' />
                        <span className='font-semibold'>{item.title || `Insight ${index + 1}`}</span>
                      </div>
                      <Badge className={`${IMPACT_STYLES[item.impact] || IMPACT_STYLES.low} border-0`}>
                        {(item.impact || 'low').toUpperCase()}
                      </Badge>
                    </div>
                    <p>{item.advice}</p>
                    {item.reason && (
                      <p className='mt-2 text-xs text-slate-500'>{item.reason}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {isWorkspaceCrudOpen && selectedWorkspace && createPortal(
        <div className='fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/25 px-2 py-4 backdrop-blur-[2px] md:px-6'>
          <div className='h-[88vh] w-[min(1180px,100%)] overflow-hidden rounded-2xl bg-white/96 backdrop-blur-md'>
            <div className='flex flex-col gap-3 border-b border-violet-100 bg-white/90 px-4 py-3 md:flex-row md:items-center md:justify-between'>
              <div>
                <p className='text-xs font-semibold uppercase tracking-[0.18em] text-violet-500'>Current Workspace</p>
                <p className='text-base font-bold text-slate-900'>{selectedWorkspace?.name}</p>
                <p className='text-xs text-slate-500'>Role: {workspacePermissions.role || 'viewer'}</p>
              </div>
              <div className='flex flex-wrap items-center justify-end gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-8 border-violet-200 bg-white px-2.5 hover:bg-violet-50'
                  onClick={openHistoryModal}
                >
                  <History className='size-4' />
                  <span className='hidden sm:inline'>History</span>
                </Button>

                {workspacePermissions.canViewMembers && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='relative h-8 border-violet-200 bg-white px-2.5 hover:bg-violet-50'
                    onClick={openMembersModal}
                  >
                    <Users className='size-4' />
                    <span className='hidden sm:inline'>Members</span>
                    {workspacePermissions.canApproveMembers && (selectedWorkspace?.pendingCount || 0) > 0 && (
                      <span className='absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white'>
                        {selectedWorkspace.pendingCount > 99 ? '99+' : selectedWorkspace.pendingCount}
                      </span>
                    )}
                  </Button>
                )}

                {workspacePermissions.canInvite && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-8 border-violet-200 bg-white px-2.5 hover:bg-violet-50'
                    onClick={fetchWorkspaceInviteCode}
                    disabled={isInviteCodeLoading}
                  >
                    <Copy className='size-4' />
                    <span className='hidden sm:inline'>{isInviteCodeLoading ? 'Loading...' : 'Get Invite Code'}</span>
                    <span className='sm:hidden'>{isInviteCodeLoading ? '...' : 'Invite'}</span>
                  </Button>
                )}

                {workspacePermissions.canDeleteWorkspace && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-8 border-rose-200 bg-white px-2.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                    onClick={deleteCurrentWorkspace}
                    disabled={isWorkspaceDeleting}
                  >
                    <Trash2 className='size-4' />
                    <span className='hidden sm:inline'>{isWorkspaceDeleting ? 'Deleting...' : 'Delete Workspace'}</span>
                    <span className='sm:hidden'>{isWorkspaceDeleting ? '...' : 'Delete'}</span>
                  </Button>
                )}

                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() => setIsWorkspaceCrudOpen(false)}
                  className='cursor-pointer shrink-0 text-slate-600 hover:bg-violet-100 hover:text-violet-700'
                >
                  <X className='size-5' />
                </Button>
              </div>
            </div>

            <div className='h-[calc(88vh-68px)] space-y-5 overflow-y-auto p-4'>
              {workspaceInviteCode && (
                <div className='flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/70 p-3'>
                  <p className='text-xs uppercase tracking-[0.16em] text-violet-700'>Invite code</p>
                  <p className='rounded bg-white px-2 py-1 text-sm font-bold tracking-[0.12em] text-violet-800'>{workspaceInviteCode}</p>
                  <Button type='button' size='sm' variant='outline' className='h-8 bg-white' onClick={copyInviteCode}>
                    <Copy className='size-4' />
                    Copy
                  </Button>
                </div>
              )}

              <AddTask handleNewTaskAdded={handleTaskChanged} workspaceId={selectedWorkspaceId} />

              <StatsAndFilters
                filter={filter}
                setFilter={setFilter}
                todoTasksCount={todoTaskCount}
                inProgressTasksCount={inProgressTaskCount}
                completedTasksCount={completedTaskCount}
              />

              <TaskList
                filteredTasks={visibleTasks}
                filter={filter}
                handleTaskChanged={handleTaskChanged}
                workspaceId={selectedWorkspaceId}
              />

              <div className='flex items-center gap-3'>
                <div className='min-w-0 flex-1'>
                  <TaskListPagination
                    handleNext={handleNext}
                    handlePrev={handlePrev}
                    handlePageChange={handlePageChange}
                    page={page}
                    totalPages={totalPages}
                  />
                </div>
                <div className='ml-auto'>
                  <DateTimeFilter dateQuery={dateQuery} setDateQuery={setDateQuery} />
                </div>
              </div>

              <Footer
                todoTasksCount={todoTaskCount}
                inProgressTasksCount={inProgressTaskCount}
                completedTasksCount={completedTaskCount}
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {isMembersModalOpen && selectedWorkspace && createPortal(
        <div className='fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/35 px-2 py-4 backdrop-blur-[2px] md:px-6'>
          <div className='h-[82vh] w-[min(860px,100%)] overflow-hidden rounded-2xl bg-white/98'>
            <div className='flex items-center justify-between border-b border-violet-100 px-4 py-3'>
              <div>
                <p className='text-xs font-semibold uppercase tracking-[0.18em] text-violet-500'>Workspace Members</p>
                <p className='text-base font-bold text-slate-900'>{selectedWorkspace.name}</p>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => setIsMembersModalOpen(false)}
                className='text-slate-600 hover:bg-violet-100 hover:text-violet-700'
              >
                <X className='size-5' />
              </Button>
            </div>

            <div className='h-[calc(82vh-68px)] space-y-4 overflow-y-auto p-4'>
              <div className='rounded-lg border border-violet-200 bg-violet-50/60 p-3'>
                <p className='text-xs text-violet-700'>Owner can approve or reject pending requests and remove members. Members can only view this list.</p>
              </div>

              <div>
                <p className='mb-2 text-sm font-semibold text-slate-800'>Active Members</p>
                {isMembersLoading ? (
                  <p className='text-sm text-slate-500'>Loading members...</p>
                ) : workspaceMembers.length === 0 ? (
                  <p className='text-sm text-slate-500'>No members.</p>
                ) : (
                  <div className='space-y-2'>
                    {workspaceMembers.map((member) => {
                      const isOwner = member.userId === workspaceOwnerId || member.role === 'owner';
                      return (
                        <div key={member.userId} className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3'>
                          <div>
                            <p className='text-sm font-semibold text-slate-900'>{member.name}</p>
                            <p className='text-xs text-slate-500'>{member.email}</p>
                          </div>
                          <div className='flex items-center gap-2'>
                            <Badge className={isOwner ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-700'}>{member.role}</Badge>
                            {workspacePermissions.canRemoveMembers && !isOwner && (
                              <Button
                                type='button'
                                variant='outline'
                                size='sm'
                                className='border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                                onClick={() => removeMember(member.userId)}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {workspacePermissions.canApproveMembers && (
                <div>
                  <p className='mb-2 text-sm font-semibold text-slate-800'>Pending Requests</p>
                  {isMembersLoading ? (
                    <p className='text-sm text-slate-500'>Loading requests...</p>
                  ) : workspacePendingMembers.length === 0 ? (
                    <p className='text-sm text-slate-500'>No pending requests.</p>
                  ) : (
                    <div className='space-y-2'>
                      {workspacePendingMembers.map((pending) => (
                        <div key={pending.userId} className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3'>
                          <div>
                            <p className='text-sm font-semibold text-slate-900'>{pending.name}</p>
                            <p className='text-xs text-slate-500'>{pending.email}</p>
                          </div>
                          <div className='flex items-center gap-2'>
                            <Button type='button' size='sm' variant='outline' className='border-emerald-200 text-emerald-700 hover:bg-emerald-50' onClick={() => approvePendingMember(pending.userId)}>
                              Approve
                            </Button>
                            <Button type='button' size='sm' variant='outline' className='border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700' onClick={() => rejectPendingMember(pending.userId)}>
                              Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {isHistoryModalOpen && selectedWorkspace && createPortal(
        <div className='fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/35 px-2 py-4 backdrop-blur-[2px] md:px-6'>
          <div className='h-[82vh] w-[min(900px,100%)] overflow-hidden rounded-2xl bg-white/98'>
            <div className='flex items-center justify-between border-b border-violet-100 px-4 py-3'>
              <div>
                <p className='text-xs font-semibold uppercase tracking-[0.18em] text-violet-500'>Workspace History</p>
                <p className='text-base font-bold text-slate-900'>{selectedWorkspace.name}</p>
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='border-violet-200 bg-white hover:bg-violet-50'
                  onClick={loadWorkspaceHistory}
                  disabled={isHistoryLoading}
                >
                  {isHistoryLoading ? 'Refreshing...' : 'Refresh'}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() => setIsHistoryModalOpen(false)}
                  className='text-slate-600 hover:bg-violet-100 hover:text-violet-700'
                >
                  <X className='size-5' />
                </Button>
              </div>
            </div>

            <div className='h-[calc(82vh-68px)] space-y-3 overflow-y-auto p-4'>
              {isHistoryLoading ? (
                <p className='text-sm text-slate-500'>Loading activity history...</p>
              ) : workspaceActivities.length === 0 ? (
                <p className='text-sm text-slate-500'>No activity yet in this workspace.</p>
              ) : (
                <div className='space-y-2'>
                  {workspaceActivities.map((activity) => (
                    <div key={activity._id} className='rounded-lg border border-slate-200 bg-white p-3'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Badge className='bg-violet-100 text-violet-700'>{activity.type}</Badge>
                        <p className='text-xs text-slate-500'>{formatActivityDateTime(activity.createdAt)}</p>
                      </div>
                      <p className='mt-1 text-sm font-medium text-slate-900'>{activity.message}</p>
                      <p className='mt-1 text-xs text-slate-500'>By: {activity.actorName || activity.actorEmail || 'System'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <ChatPanel />
    </div>


  )
}

export default HomePage;