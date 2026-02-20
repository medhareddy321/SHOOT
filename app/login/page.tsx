'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';

function LoginContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        // Email confirmation is disabled; route straight to intended page.
        router.push(next);
        router.refresh();
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        router.push(next);
        router.refresh();
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
      {/* Logo / brand */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">SHOOT</h1>
        <p className="text-white/40 text-sm mt-1">Match poses, take better photos</p>
      </div>

      {/* Auth form */}
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-white placeholder-white/30 outline-none focus:border-white/40 transition-colors"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-white placeholder-white/30 outline-none focus:border-white/40 transition-colors"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm disabled:opacity-50 hover:bg-white/90 transition-colors mt-1"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              {isSignUp ? 'Creating account...' : 'Signing in...'}
            </span>
          ) : (
            isSignUp ? 'Create Account' : 'Sign In'
          )}
        </button>
      </form>

      {/* Error / success messages */}
      {error && (
        <p className="mt-4 text-sm text-red-400 text-center max-w-sm">{error}</p>
      )}
      {message && (
        <p className="mt-4 text-sm text-green-400 text-center max-w-sm">{message}</p>
      )}

      {/* Toggle sign up / sign in */}
      <button
        onClick={() => {
          setIsSignUp(!isSignUp);
          setError(null);
          setMessage(null);
        }}
        className="mt-6 text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        {isSignUp
          ? 'Already have an account? Sign in'
          : "Don't have an account? Sign up"}
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
