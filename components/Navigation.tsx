'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Camera, Save, Image as ImageIcon, Home, LogOut, User as UserIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/camera', label: 'Camera', icon: Camera },
  { href: '/saved', label: 'Saved', icon: Save },
  { href: '/gallery', label: 'Gallery', icon: ImageIcon },
] as const;

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUserEmail(data.user?.email ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
      setMenuOpen(false);
    });
    return () => {
      mounted = false;
      listener?.subscription.unsubscribe();
    };
  }, [supabase]);

  // Hide nav on login page and camera page (fullscreen experience)
  if (pathname === '/login' || pathname === '/camera') return null;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUserEmail(null);
    setMenuOpen(false);
    router.push('/');
    router.refresh();
  };

  const initial = userEmail ? userEmail.charAt(0).toUpperCase() : null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-sm border-t border-white/10">
      <div className="flex items-center justify-between h-16 max-w-3xl mx-auto px-3">
        <div className="flex items-center justify-start gap-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors ${
                  isActive ? 'text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                <Icon size={20} />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="relative">
          {userEmail ? (
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/10 border border-white/15 text-white text-sm font-semibold"
            >
              <span className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center font-bold">
                {initial}
              </span>
              <span className="hidden sm:inline text-white/80 text-xs truncate max-w-[120px]">{userEmail}</span>
            </button>
          ) : (
            <Link
              href="/login"
              className="px-3 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              Log in
            </Link>
          )}

          {menuOpen && (
            <div className="absolute bottom-14 right-0 w-56 rounded-2xl bg-zinc-950 border border-white/10 shadow-xl overflow-hidden">
              <div className="px-3 py-2 text-xs text-white/60 border-b border-white/5 flex items-center gap-2">
                <UserIcon size={14} />
                {userEmail}
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-white hover:bg-white/5 transition-colors"
              >
                <LogOut size={16} />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
