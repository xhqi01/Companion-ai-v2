# Contributing to Companion

Thanks for your interest! Contributions of all kinds are welcome — bug reports, feature ideas, docs fixes, and code.

## Reporting bugs

Open an issue using the **Bug report** template. Please include:

- What you did, what you expected, what actually happened
- Your setup: Node version, database (Supabase / self-hosted Postgres), LLM & embedding provider
- Relevant logs (⚠️ **redact API keys, `ENCRYPTION_KEY`, `JWT_SECRET`, and any personal chat data before pasting**)

## Suggesting features

Open an issue using the **Feature request** template. Explain the use case, not just the solution — it helps evaluate alternatives.

## Development setup

```bash
git clone <your-fork>
cd companion
cp .env.example .env      # fill in DATABASE_URL, LLM_API_KEY, EMBEDDING_API_KEY, generate ENCRYPTION_KEY & JWT_SECRET
npm install
npm run db:init
npm run dev               # backend on :3001

cd frontend
cp .env.example .env
npm install
npm run dev               # frontend dev server
```

A free [Supabase](https://supabase.com) project works fine for development (run `db/schema.sql` in the SQL Editor first).

## Pull requests

1. Fork → branch (`feat/xxx` or `fix/xxx`) → PR against `main`
2. Keep PRs focused: one change per PR
3. Match the existing code style (ES modules, no build step for the backend, comments in Chinese or English are both fine)
4. If you change API behavior, update the API list in `README.md` (all three languages if you can — English only is also acceptable, mention it in the PR)
5. If you change the embedding dimension or schema, update `db/schema.sql` and call it out clearly

## Security

If you find a security vulnerability (auth bypass, cross-user data access, crypto misuse), please **do not open a public issue** — report it privately via GitHub Security Advisories on this repo.

## A note on scope

This project intentionally stays small and provider-agnostic. Features that add heavy dependencies, lock into a single LLM vendor, or turn the backend into a framework will likely be declined — but discussion is always welcome.
