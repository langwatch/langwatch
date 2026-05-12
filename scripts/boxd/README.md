# Boxd VM provisioning

Scripts and templates that turn the Boxd golden image into a reproducible,
reviewable piece of infrastructure (#3203).

## What lives here

| File                       | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `.env.golden.template`     | Sanitized `.env` shape for the golden VM. No live API keys.     |
| `create-golden.sh`         | Provision a fresh golden VM and render `.env` from the template |
| `boxd-fork.sh`             | Fork the golden into a per-PR test VM                           |

## When to use this

The "golden" VM (`langwatch-main` by default) is the source filesystem
that every per-PR test VM forks from. Forking is fast (~30s) because the
golden already has node_modules, docker images, and migration state
warmed up.

The previous workflow kept `boxd-fork.sh` on the golden VM only —
untracked, undocumented, and prone to drift. Symptoms that motivated the
rewrite (#3203):

- `OPENAI_API_KEY` set to an invalid placeholder ⇒ every fork hit a 401
  upstream at LiteLLM
- `ELASTICSEARCH_NODE_URL` pointed at a dead cloud endpoint ⇒ collector
  returned HTTP 500 "Deleted resource." on every trace POST
- `LANGWATCH_ENDPOINT` unset ⇒ scenarios worker crashed at startup

## How to (re)build a golden

```bash
# One-time, when no golden exists or you want a personal one:
scripts/boxd/create-golden.sh langwatch-main         # the shared golden
scripts/boxd/create-golden.sh langwatch-main-alice   # personal golden

# Inject your LLM provider keys (NOT committed):
boxd ssh langwatch-main
$EDITOR ~/workspace/langwatch/langwatch/.env
# add OPENAI_API_KEY=..., ANTHROPIC_API_KEY=..., etc.
cd ~/workspace/langwatch && make down && make dev
```

## How to fork a PR

```bash
# From any host with the boxd CLI:
scripts/boxd/boxd-fork.sh 1234                       # uses langwatch-main
scripts/boxd/boxd-fork.sh 1234 --from langwatch-main-alice
```

The fork:
1. Snapshots the golden's filesystem (fast).
2. Rewrites `BASE_HOST`, `NEXTAUTH_URL`, `LANGWATCH_ENDPOINT` to the
   fork's hostname. Everything else (secrets, infra URLs) inherits from
   the golden.
3. `gh pr checkout`s the requested PR.
4. Restarts the dev stack.

## Adding new env vars

Add the var to **both**:
1. `langwatch/.env.example` (canonical doc for local dev).
2. `scripts/boxd/.env.golden.template` (with a sane default or empty
   value — never a fake placeholder string; see the template's header).

Secrets that must be per-VM unique (signing keys, peppers) use the
`PLACEHOLDER_REGENERATE_ME` token in the template. `create-golden.sh`
replaces every occurrence with a fresh `openssl rand -hex 32`.

## Why not commit the `.env` directly

Golden is shared. A committed `.env` either contains live keys (security
leak) or fake placeholders that pass the linter and silently 401 against
real upstreams (the bug that motivated this directory). The template +
render-on-create flow keeps the shape in version control while letting
each VM hold its own secrets.
