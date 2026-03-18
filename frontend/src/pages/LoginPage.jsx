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
      if (error.code === "ECONNABORTED") {
        toast.error("Request timed out. Please try resending verification email again.");
        return;
      }

      const message = error.response?.data?.message || "Failed to resend verification email";
      toast.error(message);
    } finally {
      setIsResending(false);
    }
  };

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

      <div className="relative z-10 flex min-h-screen items-stretch justify-start">
        <section className="flex w-full items-center justify-center bg-transparent px-5 py-8 sm:px-8 md:w-[48%] lg:w-[42%] md:justify-start">
          <Card className="w-full max-w-md space-y-5 border-0 bg-white/[0.001] p-8 shadow-custom-lg backdrop-blur-sm">
            <div className="space-y-1 text-center md:text-left">
              <h1 className="text-3xl font-bold text-primary">Welcome Back</h1>
              <p className="text-sm text-slate-200">Sign in to manage your tasks</p>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              <Input
                name="email"
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={onChange}
                autoComplete="email"
                className="border-white/80 bg-transparent text-white placeholder:text-slate-300"
              />

              <Input
                name="password"
                type="password"
                placeholder="Password"
                value={form.password}
                onChange={onChange}
                autoComplete="current-password"
                className="border-white/80 bg-transparent text-white placeholder:text-slate-300"
              />

              <Button type="submit" variant="gradient" size="xl" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Signing in..." : "Login"}
              </Button>

              {showResend && (
                <div className="rounded-md border border-white/70 bg-black/20 p-3 text-sm">
                  <p className="mb-2 text-slate-100">
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

            <p className="text-center text-sm text-slate-200 md:text-left">
              Don&apos;t have an account?{" "}
              <Link to="/register" className="font-semibold text-primary hover:underline">
                Register now
              </Link>
            </p>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;
