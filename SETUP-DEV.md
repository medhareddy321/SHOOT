# Dev setup — API & environment

## 1. Install dependencies

From the project root (this folder):

```bash
npm install
```

## 2. Environment (Supabase API)

- Copy the example env file:
  ```bash
  copy .env.example .env.local
  ```
  (On macOS/Linux: `cp .env.example .env.local`)

- Get your Supabase keys:
  1. Go to [Supabase](https://supabase.com) and sign in (or create a free account).
  2. Create a new project (or use an existing one).
  3. Open **Project Settings** (gear) → **API**.
  4. Copy:
     - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`
     - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`

- Edit `.env.local` and replace the placeholders with those values. Example:

  ```
  NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
  ```

**Note:** If you skip this step, the app still runs; auth and saved/gallery features are disabled until the env vars are set.

## 3. Supabase database (tables)

In the Supabase dashboard: **SQL Editor** → New query. Paste and run the SQL from **README.md** (the block that creates `saved_photos` and `gallery_photos` and their RLS policies).

## 4. Run the dev server

```bash
npm run dev
```

Open **http://localhost:3000**. Use **/login** to sign up/sign in (after Supabase env is set).

## Quick reference

| What              | Where |
|-------------------|--------|
| API base URL      | `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` |
| API key (anon)    | `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` |
| Supabase API docs | Dashboard → Project Settings → API |
| Tables + RLS      | README.md → “Supabase setup (SQL)” |
