import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const LoginPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const shouldShowResendOnLoad = searchParams.get("resend") === "1";
  const { login, resendVerification } = useAuth();
  const [form, setForm] = useState({ email: initialEmail, password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResend, setShowResend] = useState(shouldShowResendOnLoad);
  const [isResending, setIsResending] = useState(false);

  const onChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();

    if (!form.email.trim() || !form.password) {
      toast.error("Email and password are required");
      return;
    }

    try {
      setIsSubmitting(true);
      await login({ email: form.email, password: form.password });
      setShowResend(false);
      toast.success("Login successful");
      navigate("/");
    } catch (error) {
      const message = error.response?.data?.message || "Login failed";
      toast.error(message);
      setShowResend(
        error.response?.status === 403 &&
          /verify your email/i.test(message)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (!form.email.trim()) {
      toast.error("Please enter your email first");
      return;
    }

    try {
      setIsResending(true);
      const result = await resendVerification({ email: form.email });
      toast.success(result.message || "Verification email has been resent");
    } catch (error) {
      const message = error.response?.data?.message || "Failed to resend verification email";
      const verificationUrl = error.response?.data?.verificationUrl;

      if (verificationUrl) {
        toast.info("Email service is unavailable. Opening verification link directly.");
        window.location.assign(verificationUrl);
        return;
      }

      toast.error(message);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div
        className="absolute inset-0 z-0"
        style={{
          background: "radial-gradient(130% 130% at 50% 0%, #eef2ff 20%, #c4b5fd 100%)",
        }}
      />

      <Card className="relative z-10 w-full max-w-md space-y-5 border-0 bg-gradient-card p-8 shadow-custom-lg">
        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-bold text-primary">Welcome Back</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage your tasks</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <Input
            name="email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={onChange}
            autoComplete="email"
          />

          <Input
            name="password"
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={onChange}
            autoComplete="current-password"
          />

          <Button type="submit" variant="gradient" size="xl" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Login"}
          </Button>

          {showResend && (
            <div className="rounded-md border border-border/70 bg-background/70 p-3 text-sm">
              <p className="mb-2 text-muted-foreground">
                Your account is not verified yet. We can resend the verification email.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleResendVerification}
                disabled={isResending}
              >
                {isResending ? "Resending..." : "Resend Verification Email"}
              </Button>
            </div>
          )}
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="font-semibold text-primary hover:underline">
            Register now
          </Link>
        </p>
      </Card>
    </div>
  );
};

export default LoginPage;
