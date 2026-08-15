"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.push("/portal");
        router.refresh();
      } else {
        setError(data.error || "Incorrect password.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand logo — always on a solid black shell, aspect preserved */}
        <div className="logo-black-shell rounded-2xl w-28 h-28 mx-auto mb-6 overflow-hidden">
          <Image
            src="/images/logo-no-background.png"
            alt="Coffs Coast Pest Control logo"
            width={112}
            height={112}
            className="w-full h-full object-contain"
            priority
          />
        </div>

        <h1 className="text-center text-2xl font-bold text-white mb-1">
          Client Content Portal
        </h1>
        <p className="text-center text-sm text-neutral-400 mb-8">
          Coffs Coast Pest Control
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-neutral-400 mb-1 uppercase tracking-wide">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 outline-none focus:border-white focus:ring-1 focus:ring-white"
              placeholder="Enter portal password"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-white text-black font-semibold hover:bg-neutral-200 transition disabled:opacity-60"
          >
            {loading ? <span className="spinner" /> : "Unlock Portal"}
          </button>
        </form>
      </div>
    </div>
  );
}
