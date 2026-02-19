## SHOOT — Pose-match camera (Next.js)

Mobile-first Next.js app with MediaPipe pose matching, Supabase auth/storage, saved pose templates, and gallery captures.

### Prerequisites
- Node 20+ (or the version in `.nvmrc` if present)
- npm (bundled with Node)
- Supabase project (free tier fine)

### Install
```bash
npm install
```

### Environment
See **[SETUP-DEV.md](./SETUP-DEV.md)** for step-by-step API/env setup. Quick version:

1. Copy `.env.example` → `.env.local`
2. In [Supabase](https://supabase.com) → your project → **Settings → API**, copy **Project URL** and **anon public** key into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL=<Project URL>`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>`

### Supabase setup (SQL)
Run in Supabase SQL editor:
```sql
-- Saved templates a user bookmarks
create table if not exists saved_photos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  photo_data text not null,
  pose_name text not null,
  match_score integer not null,
  created_at timestamp default now()
);
alter table saved_photos enable row level security;
create policy "view saved"   on saved_photos for select using (auth.uid() = user_id);
create policy "insert saved" on saved_photos for insert with check (auth.uid() = user_id);
create policy "delete saved" on saved_photos for delete using (auth.uid() = user_id);

-- Gallery captures (actual photos taken)
create table if not exists gallery_photos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  photo_data text not null,
  pose_name text not null,
  match_score integer not null,
  capture_type text not null check (capture_type in ('auto','manual')),
  created_at timestamp default now()
);
alter table gallery_photos enable row level security;
create policy "view gallery"   on gallery_photos for select using (auth.uid() = user_id);
create policy "insert gallery" on gallery_photos for insert with check (auth.uid() = user_id);
create policy "delete gallery" on gallery_photos for delete using (auth.uid() = user_id);
```

### Run dev server
```bash
npm run dev
```
Open http://localhost:3000. Browser will ask for camera permission on the camera page.

### Deploy (Vercel)
See **[DEPLOY.md](./DEPLOY.md)**. Quick: add the same env vars in Vercel → Settings → Environment Variables, then run `npm run deploy` to push updates to production.

### Notes
- Auth: Supabase email/password via `/login`. Middleware protects `/camera`, `/saved`, `/gallery` when env keys are set.
- Storage: All saves/read/delete go to Supabase tables above; no localStorage fallback.
- Poses: Seed templates live in `lib/poses.ts` and images under `public/poses/`.
