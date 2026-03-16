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
      toast.success(result.message || "Verification email sent. Please check your inbox.");

      if (result.emailDeliveryFailed) {
        if (result.verificationUrl) {
          window.location.assign(result.verificationUrl);
          return;
        }
        navigate(`/login?email=${encodeURIComponent(form.email.trim())}&resend=1`);
      } else {
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
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <div
        className="absolute inset-0 z-0"
        style={{
          background: "radial-gradient(130% 130% at 50% 0%, #f0fdfa 20%, #67e8f9 100%)",
        }}
      />

      <Card className="relative z-10 w-full max-w-md space-y-5 border-0 bg-gradient-card p-8 shadow-custom-lg">
        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-bold text-primary">Create Account</h1>
          <p className="text-sm text-muted-foreground">Start managing your tasks privately</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <Input
            name="name"
            type="text"
            placeholder="Full name"
            value={form.name}
            onChange={onChange}
            autoComplete="name"
          />

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
            autoComplete="new-password"
          />

          <Button type="submit" variant="gradient" size="xl" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating account..." : "Register"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Login
          </Link>
        </p>
      </Card>
    </div>
  );
};

export default RegisterPage;
