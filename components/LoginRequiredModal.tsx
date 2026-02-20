'use client';

import { useRouter } from 'next/navigation';

type Props = {
  open: boolean;
  onClose: () => void;
  message?: string;
  next?: string;
};

/** Simple login gate modal shown when an auth-only action is attempted. */
export function LoginRequiredModal({ open, onClose, message = 'Please log in to continue', next = '/' }: Props) {
  if (!open) return null;

  const router = useRouter();
  const loginHref = `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-zinc-950 border border-white/10 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-white">Login required</h2>
        <p className="text-sm text-white/60 mt-1.5">{message}</p>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white text-sm font-semibold hover:bg-white/15 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => router.push(loginHref)}
            className="flex-1 text-center py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors"
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginRequiredModal;
