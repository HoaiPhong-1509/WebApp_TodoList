import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import api from "@/lib/axios";

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Verifying your email...");
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }

    if (hasRequestedRef.current) {
      return;
    }

    hasRequestedRef.current = true;

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
  }, [token]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-900">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url('/bg_login.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <div className="absolute inset-0 bg-slate-900/30" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-8 sm:px-8">
          <Card className="w-full max-w-md space-y-4 border-0 bg-white/[0.001] p-8 text-center shadow-custom-lg backdrop-blur-sm">
            <h1 className="text-2xl font-bold text-primary">Email Verification</h1>
            <p className="text-sm text-slate-200">{message}</p>

            {status !== "loading" && (
              <Button asChild variant="gradient" size="xl" className="w-full">
                <Link to="/login">Go to Login</Link>
              </Button>
            )}
          </Card>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
