import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import api from "@/lib/axios";

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }

    const verify = async () => {
      try {
        const res = await api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`);
        setStatus("success");
        setMessage(res.data.message || "Email verified successfully.");
      } catch (error) {
        setStatus("error");
        setMessage(error.response?.data?.message || "Email verification failed.");
      }
    };

    verify();
  }, [searchParams]);

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div
        className="absolute inset-0 z-0"
        style={{
          background: "radial-gradient(130% 130% at 50% 0%, #ecfeff 20%, #a5f3fc 100%)",
        }}
      />

      <Card className="relative z-10 w-full max-w-md space-y-4 border-0 bg-gradient-card p-8 text-center shadow-custom-lg">
        <h1 className="text-2xl font-bold text-primary">Email Verification</h1>
        <p className="text-sm text-muted-foreground">{message}</p>

        {status !== "loading" && (
          <Button asChild variant="gradient" size="xl" className="w-full">
            <Link to="/login">Go to Login</Link>
          </Button>
        )}
      </Card>
    </div>
  );
};

export default VerifyEmailPage;
