import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export const ProtectedRoute = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export const GuestOnlyRoute = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading...</div>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return children;
};
