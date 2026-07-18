import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MessageSquare, ArrowRight, Sparkles } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setIsLoading(true);
    setError('');

    const defaultPassword = 'simple_chat_session_password_123';

    try {
      // Step 1: Attempt login first
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: defaultPassword })
      });

      if (loginRes.ok) {
        const data = await loginRes.json();
        login(data.token, data.user);
        navigate('/');
        return;
      }

      // Step 2: If login failed, attempt to register
      const registerRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: defaultPassword })
      });

      if (registerRes.ok) {
        const data = await registerRes.json();
        login(data.token, data.user);
        navigate('/');
        return;
      }

      // If both failed, display registration error
      const registerData = await registerRes.json();
      setError(registerData.error || 'Failed to connect. Please try another name.');
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-violet-950 flex items-center justify-center p-4 selection:bg-indigo-500 selection:text-white">
      {/* Decorative background lights */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="max-w-md w-full bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl shadow-2xl p-8 md:p-10 space-y-8 relative overflow-hidden transition-all duration-300 hover:border-slate-700/80">
        <div className="text-center space-y-3 relative z-10">
          <div className="bg-gradient-to-tr from-indigo-500 to-violet-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/30 transform hover:scale-105 transition-transform duration-300">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400 animate-bounce" />
            <h1 className="text-3xl font-extrabold tracking-tight text-white bg-gradient-to-r from-white via-indigo-100 to-slate-200 bg-clip-text text-transparent">
              Welcome to Chat
            </h1>
          </div>
          <p className="text-slate-400 text-sm md:text-base font-medium">
            Enter your name to join the conversation instantly
          </p>
        </div>

        {error && (
          <div className="bg-red-500/15 border border-red-500/30 text-red-300 px-4 py-3 rounded-2xl text-sm text-center relative z-10">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
          <div className="space-y-2">
            <label htmlFor="username-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 ml-1">
              Your Name
            </label>
            <input
              id="username-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Alex Mercer"
              className="w-full px-5 py-4 bg-slate-950/50 border border-slate-800 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-base"
              required
              autoFocus
              maxLength={25}
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !username.trim()}
            className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white font-semibold py-4 px-5 rounded-2xl shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:pointer-events-none group"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Let's Chat
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        <div className="text-center pt-2 text-xs text-slate-500 font-medium">
          No password or sign up required.
        </div>
      </div>
    </div>
  );
}
