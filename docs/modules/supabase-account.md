# Module: supabase-account

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail.

## What you get
`supabase login` stores **one** token per machine. On a machine with several Supabase accounts, whichever logged in last wins, and nothing says which. The failure isn't an error message: it's a migration applied to the wrong company's database.

`npm run supabase -- <command>` runs the Supabase CLI with **this repo's own token**, from the gitignored `.env`. It refuses to run unless that token can see the projects listed in `supabase/projects.json`. `npm run supabase:whoami` names the account, or says exactly why it can't.

Only offered when the repo uses Supabase (a `supabase/` directory, or a `SUPABASE_` variable in `.env.example`).

## What it changes outside your repo
Nothing beyond what your Supabase commands do. The token stays in `.env`, which is never committed.

## Cost
Nothing.

## Set up
1. **Fill in `supabase/projects.json`.** It ships with `REPLACE_ME` placeholders, and every command refuses to run until they're real. You can read the refs from any project's dashboard URL. The refs aren't secrets.
2. Sign in to supabase.com as the account that owns the projects, generate a token at `https://supabase.com/dashboard/account/tokens`, and put `SUPABASE_ACCESS_TOKEN=sbp_...` in `.env`.
3. `npm run supabase:whoami`.

## Fix a finding

### "still contains placeholder values"
Do step 1 above.

### "SUPABASE_ACCESS_TOKEN is not set in .env"
Do step 2 above.

### Missing file
`scripts/supabase.mjs` or `supabase/projects.json` is absent. Re-run `/govkit-init`.

### Missing npm script
`supabase` or `supabase:whoami` isn't in `package.json`. Re-run `/govkit-init`.

### Outdated
Run `/govkit-init --upgrade`.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json`, delete `scripts/supabase.mjs` and `supabase/projects.json`, and use the Supabase CLI directly.
