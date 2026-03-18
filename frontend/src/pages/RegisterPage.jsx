import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const RegisterPage = () => {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onChange = (event) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.password) {
      toast.error("Name, email and password are required");
      return;
    }

    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await register(form);
      if (result.emailDeliveryFailed) {
        toast.error(result.message || "Email service is temporarily unavailable. Please continue from login and resend verification email.");
        navigate(`/login?email=${encodeURIComponent(form.email.trim())}&resend=1`);
      } else {
        toast.success(result.message || "Verification email sent. Please check your inbox.");
        navigate("/login");
      }
    } catch (error) {
      if (error.code === "ERR_NETWORK") {
        toast.error("Cannot connect to server. Please check backend/CORS configuration.");
      } else if (error.code === "ECONNABORTED") {
        toast.info("Request timed out. If your account was created, please continue from login and resend verification email.");
        navigate(`/login?email=${encodeURIComponent(form.email.trim())}&resend=1`);
      } else {
        toast.error(error.response?.data?.message || "Register failed");
      }
    } finally {
      setIsSubmitting(false);
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
              <h1 className="text-3xl font-bold text-primary">Create Account</h1>
              <p className="text-sm text-slate-200">Start managing your tasks privately</p>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              <Input
                name="name"
                type="text"
                placeholder="Full name"
                value={form.name}
                onChange={onChange}
                autoComplete="name"
                className="border-white/80 bg-transparent text-white placeholder:text-slate-300"
              />

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
                autoComplete="new-password"
                className="border-white/80 bg-transparent text-white placeholder:text-slate-300"
              />

              <Button type="submit" variant="gradient" size="xl" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Creating account..." : "Register"}
              </Button>
            </form>

            <p className="text-center text-sm text-slate-200 md:text-left">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Login
              </Link>
            </p>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default RegisterPage;
