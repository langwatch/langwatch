---
name: haven-auth
description: "Sign in to this worktree's stack as admin or a seeded login with `haven auth`, which writes a Playwright storage-state file and never prints the password. Use when someone says 'haven auth', 'sign in as admin', 'log in as a seeded user', 'storage state', 'a signed-in session for a script', 'what is the admin login', 'login for a Playwright test', or 'how do I get a session without a password'."
user-invocable: true
argument-hint: "<admin|email> [--out file] [--json] [--stack slug]"
---

# haven auth

```bash
haven auth admin                          # the stack's admin; state goes to haven's per-stack browser dir
haven auth admin --out .claude/tmp/state.json   # a Playwright storage state, mode 600
haven auth someone@seed.test --json       # a seeded login by email; JSON {who, email, app, file}
```

- It signs in through the app's normal email sign-in and writes the session cookies as a
  Playwright storage state (owner-only, mode 600). The password is never printed.
- It refuses any app that is not on this machine, so a dev password never travels elsewhere.
- Needs a running stack: `haven up --agent -d`. `--stack <slug>` signs in to another worktree's.
- `admin` is the stack's admin account (`LANGWATCH_ADMIN_EMAIL`, from the overlay or `.env`).
  Any other login must be an email a seed created; `haven seed --json` lists them.
  Seeded logins share one fixed local dev password defined in `tools/thuishaven/domain/identity.go`;
  never type it or paste it anywhere. Let `haven auth` and `--as` use it.
- The default file lives at `<haven browser dir>/auth/<who>.json`.

## With browser lanes

You usually do not run `haven auth` yourself: `haven browser open ... --as admin` signs the
lane in and re-signs it if it lands on sign-in. Use `haven auth --out` when a Playwright
script outside haven needs a signed-in state, then load it with
`haven browser state-load <file> --lane <name>`. See `haven-browser`.

Rules: a state file is a credential. Keep it under `.claude/tmp/`, never commit it, never paste it.
