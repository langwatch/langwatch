# PR #4544 — final UX walkthrough (post-Stage-A, branch HEAD 5f2f82b2f)

Captured against a local `all-local` stack at `:5560` after merging all lane work:
sergey's native TS extractors + LogRequestCollectionService synth + foldProjection lift,
alexis's auth-cli shadow routes + Stage A platform-tool policy gate,
andre's codex `/v1/traces` suffix + traceSummary log-record persistence gate.

## /me personal portal

| File | What it shows |
|---|---|
| `01-me-home-ai-tools.png` | `/me` AI Tools landing. Tiles for Claude cowork / Codex (Installed) / Cursor / Gemini / opencode / Raw OTLP. CLI install + login snippet inline. |
| `02-me-traces-list.png` | Personal workspace traces. Two `ORIGIN=Binding` rows (claude + codex Path B), several `ORIGIN=Application` rows (Path A via gateway). |
| `03-me-configure.png` | `/me/configure` — personal-mode setup surface (VK, governance). |
| `04-me-sessions.png` | `/me/sessions` — device sessions list. |

## Admin governance

| File | What it shows |
|---|---|
| `10-admin-governance-overview.png` | Top-level AI Governance dashboard. Setup checklist + CLI onboarding snippet. |
| `11-admin-ingestion-sources.png` | Ingestion Sources page (Push / Pull / S3 admin-custom shapes, 0/3 configured). |
| `12-admin-tool-catalog.png` | AI Tool Catalog — Tool Tiles tab. Starter-pack picker for coding assistants + model providers. |
| `13-admin-cost-centers.png` | Cost Centers overview. |
| `14-admin-users.png` | All users by spend. |
| `15-admin-teams.png` | All teams by spend. |
| `16-admin-anomaly-rules.png` | Anomaly Rules surface. |

## Path B trace details (rendered langwatch.* attributes after the lift)

For each tool: the **Thread** view (input/output preview) and the **Trace Details** view
(canonical `langwatch.*` attribute chips lifted by the native TS extractors).

| File | Tool | Trace ID | Model |
|---|---|---|---|
| `20-claude-pathb-thread.png` | claude (Path B) | `fde8e09a2c0a34f8950c4fba68d9d3e1` | claude-haiku-4-5 |
| `21-claude-pathb-attrs.png` | claude (Path B) | same | `langwatch.source=claude_code`, `langwatch.origin=binding`, gen_ai.provider=anthropic, cost + tokens lifted |
| `22-codex-pathb-thread.png` | codex (Path B) | `7b2b44428d4ab032ed7c382fee171ed9` | gpt-5.5 |
| `23-codex-pathb-attrs.png` | codex (Path B) | same | `langwatch.source=codex`, cost $0.06235, 8000+745 tokens |
| `30-gemini-pathb-thread.png` | gemini (Path B) | `4ca5bfb5493a71774483f282330b7a7d` | gemini-3-flash-preview |
| `31-gemini-pathb-attrs.png` | gemini (Path B) | same | `langwatch.source=gemini`, `langwatch.model=gemini-3-flash-preview` lifted from gen_ai.* log records, `langwatch.reserved.log_record_count=2` |
| `40-opencode-pathb-tmux.txt` | opencode (Path B) | n/a — no OTLP emitted | `langwatch opencode run` returned the PONG but the CLI does not export OTLP from `run` subcommand; same gap andre flagged for Path A. Receiver is ready — opencode upstream issue. |

## What's new vs the pre-Stage-A screenshots

Stage A is a wrapper-side policy gate; it does not change the trace renderer. These
captures match shape with the earlier andre dogfood (screenshots 14 / 15 / 16 / 17 in
`path-b-dogfood/`) and add: the personal `/me` AI Tools landing (never previously
screenshot'd) plus the full admin governance walkthrough.

## Reproducing

```bash
make quickstart all-local
DATABASE_URL='postgresql://prisma:prisma@localhost:5432/mydb?schema=mydb' \
  DOGFOOD_OWNER_EMAIL=<your-email> npx tsx scripts/seed-dogfood-password.ts
DOGFOOD_USER_EMAIL='<your-email>' DOGFOOD_PASSWORD='DogfoodPassword!2026' \
  node /tmp/lw-codex-gemini/scripts/capture-pr4544-ux.mjs
```
