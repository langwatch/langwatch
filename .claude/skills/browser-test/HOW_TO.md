# Browser test: how to

Gotchas for walking a feature with `haven browser` (see `haven-browser`, `haven-auth`). Dated
run notes live in `history/`; they describe the setup of their day, not today's.

## Before starting

1. **Stack and origin.** `haven status` names the stack and its URL. Use that origin throughout:
   the trusted origin comes from the auth config, so `127.0.0.1` or a bare `localhost:<port>`
   403s the sign-in while anonymous pages still load. `haven browser ... --as admin` handles
   sign-in and re-signs a lane that lands on the sign-in page.
2. **First load is slow under Vite** (`pnpm dev:hmr`): chunks compile on first visit, tens of
   seconds. The default stack serves the built UI and loads fast. Wait with
   `--wait-for 'text=...'`, not sleeps.

## Authentication and accounts

- Use `--as admin` or a seeded login (`haven db seed --json` lists them). Never type, read or
  print a password.
- A new account hits onboarding (org name, terms, product flavour). Prefer a seeded login so
  the walk starts past it.

## Data seeding

Create the minimum through the UI: a suite (Suites, Create, name, save, confirm it is listed),
a run (open the suite, Run, wait for Completed, up to 120 s when a worker is involved), a trace
(send it with the SDK using a personal scoped key, or use `haven db seed`). Wait on text such as
"Completed", not a fixed delay.

## Chakra gotchas

- A checkbox click can be intercepted by Chakra's overlay element ("intercepts pointer
  events"): click its label text instead.
- Overlays are one routed drawer or dialog at a time. Assert that, that back returns to the
  caller and that a draft is restored. A second copy of the same overlay is a defect: report it.

## Interaction tips

- Actions answer with a diff (what changed, requests made, console errors): read it before taking
  a `snapshot`. Use `snapshot --grep <text>` on big pages.
- `haven browser network --failed` and `console --level error` show whether data loaded.
- Screenshots: one per step that checks how something looks, and one per failure. A snapshot
  cannot show width, padding, colour or dark-mode paint.

## Known issues

| Issue                                 | Workaround                                                 |
| ------------------------------------- | ---------------------------------------------------------- |
| First route stalls under Vite         | `haven browser goto` the same URL again                    |
| Sign-in 403s                          | Browse the stack's configured hostname from `haven status` |
| Checkbox click intercepted by overlay | Click the label text                                       |
| Splash shows but queries resolved     | Wait with `--wait-for`; the chunks are still building      |

## After finishing

Write the report (SKILL.md section 4), close the lane, and return the table.
