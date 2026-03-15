import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      toast.success("Login successful");
      navigate("/");
    } catch (error) {
      toast.error(error.response?.data?.message || "Login failed");
    } finally {
      setIsSubmitting(false);
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
