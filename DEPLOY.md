# Deploy on Vercel

## One-time: connect project

1. Push your code to **GitHub** (or GitLab/Bitbucket).
2. Go to [vercel.com](https://vercel.com) → **Add New** → **Project** → import this repo.
3. **Environment variables:** In the Vercel project → **Settings** → **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key  
   (Same values as in `.env.local`.)
4. Deploy. Vercel will run `npm run build` and deploy.

## Deploy updated changes

**Option A — From your machine (recommended to see updates immediately):**

```bash
npm install
npm run deploy
```

That runs `vercel --prod` and deploys the current code to production. The first time you’ll be prompted to log in to Vercel and link this folder to a project.

**Option B — Git push:**  
Push to the branch connected to Vercel (e.g. `main`); Vercel will auto-deploy on every push.

## Teammates: deploy from your machine too

Yes. Anyone with access to the repo and the Vercel project can run:

```bash
npm install
npx vercel login
npm run deploy
```

- **First time:** When Vercel asks “Set up and deploy?”, choose **Link to existing project** and select the same project (you must be invited to that Vercel project/team).
- After that, `npm run deploy` will always push to that project.

To invite someone: Vercel project → **Settings** → **Team** (or your Vercel dashboard team) → invite their email.
