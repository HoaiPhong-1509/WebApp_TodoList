import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/axios";
import { clearAuthToken, getAuthToken, setAuthToken } from "@/lib/authToken";
import { AuthContext } from "@/contexts/auth-context";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCurrentUser = async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await api.get("/auth/me");
      setUser(res.data.user);
    } catch {
      clearAuthToken();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const register = async (payload) => {
    const res = await api.post("/auth/register", payload);
    return res.data;
  };

  const login = async (payload) => {
    const res = await api.post("/auth/login", payload);
    setAuthToken(res.data.token);
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = () => {
    clearAuthToken();
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      isLoading,
      register,
      login,
      logout,
    }),
    [user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
