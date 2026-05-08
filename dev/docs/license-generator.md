# License generator (dev / QA / seeding)

> Self-hosted LangWatch installs gate the Enterprise feature surface (audit log,
> ingestion sources, anomaly rules, multi-user surfaces, the full governance
> dashboard) on a real signed license file. There is **no env-var bypass**.
> Dogfooding, QA, and seed scripts must therefore generate a real license — the
> generator script in this doc is the only supported path.

## Why no env-var bypass

We previously shipped a `LANGWATCH_DEV_FORCE_ENTERPRISE` env-var escape hatch
that unlocked the Enterprise feature surface without a signed license file.
That was removed because:

1. **It bakes the bypass into the codebase.** Any reader of `/dev/docs/`,
   `langwatch/.env.example`, or `git log` learns how to skip licensing in one
   line. The friction protecting the Enterprise tier should be **getting a
   license**, not finding the env var.
2. **It papers over real plan-resolution bugs.** When the bypass is on,
   self-hosted installs see Enterprise even if `getActivePlan()` would return
   FREE. Bugs in plan-resolution code paths stay invisible to dogfood.
3. **It diverges from the production path.** Real customers hit a different
   code path than QA / dogfood, so any QA pass against the bypass tells you
   nothing about the real customer experience.

The replacement: a small CLI that signs a real license using the
`LANGWATCH_LICENSE_PRIVATE_KEY` env var, writes it to the License table, and exits.
Used by every dogfood / QA / seed flow that needs Enterprise surfaces unlocked.

## Pre-requisites

- `LANGWATCH_LICENSE_PRIVATE_KEY` set in `langwatch/.env` (RSA private key, paired with
  the public key compiled into the verifier at
  `langwatch/ee/licensing/signing.ts`). Ask the maintainer for the dev key —
  it is **not** checked into the repo.
- Postgres reachable via `DATABASE_URL`.
- The target organization already exists (the script writes a `License` row
  scoped to an existing `Organization.id`).

## Usage

```bash
# Generate + persist an Enterprise license for an existing org (defaults)
LANGWATCH_LICENSE_PRIVATE_KEY=$(cat private.pem) \
  pnpm tsx scripts/generate-license.ts \
    --org-id <organizationId>

# Override defaults
LANGWATCH_LICENSE_PRIVATE_KEY=$(cat private.pem) \
  pnpm tsx scripts/generate-license.ts \
    --org-id <organizationId> \
    --plan ENTERPRISE \
    --max-members 25 \
    --email admin@acme.test
```

Arguments:

| Flag | Required | Default | Description |
|---|---|---|---|
| `--org-id` | yes | — | Target `Organization.id` to attach the license to. Org must already exist. |
| `--plan` | no | `ENTERPRISE` | One of `ENTERPRISE` / `GROWTH` / `PRO`. Plan templates live at `langwatch/ee/licensing/planTemplates.ts`. |
| `--max-members` | no | `50` | Seat cap. Must be ≥ 1. |
| `--email` | no | `<orgSlug>@local.test` | Issued-to email for the license metadata + audit-trail field. |

Output: prints the encoded license key to stdout + writes/updates the
`Organization.license` + `Organization.licenseExpiresAt` columns. The
org's plan resolution returns the new plan on the next `getActivePlan()`
call.

If `LANGWATCH_LICENSE_PRIVATE_KEY` is not set in env, the script emits a
warning, skips the license mint, and the org falls through to the FREE
plan. **That is the no-bypass intent** — operators who don't set the
env var get the gated behavior, not a silent Enterprise unlock.

## Programmatic API

For seed scripts that need to ensure an org has a license without
shelling out, the same module exports `applyLicenseToOrg`:

```ts
import { applyLicenseToOrg } from "../scripts/generate-license";

await applyLicenseToOrg({
  prisma,
  organizationId,
  planType: "ENTERPRISE",
  privateKey: process.env.LANGWATCH_LICENSE_PRIVATE_KEY,
  // optional: maxMembers, email
});
```

The dogfood seed at `langwatch/scripts/seed-gateway-dogfood.ts` ships an
idempotent `ensureOrgHasLicense(orgId)` helper that wraps `applyLicenseToOrg`
— skips if the org already has a valid license, warns if the env var is
unset, and is safe to call on every seed run.

## When to use

- **Self-hosted dogfood** — generate an Enterprise license for the dogfood
  org so multi-user / governance / ingestion-source surfaces unlock.
- **QA scripts** — `langwatch/scripts/_qa-*.mjs` create test orgs; each one
  needs a license matching the test's plan-tier expectations. Wire the
  generator into the QA bootstrap.
- **Local-dev seed** — when running `pnpm dev:seed` against a fresh DB,
  the seed script generates a license for the seed org so the developer
  starts with the full surface unlocked locally. Same code path as
  production licensing — no env-var divergence.
- **Customer support reproduction** — if a customer reports a bug that
  requires their plan tier, generate a matching license against a local
  org instead of toggling a bypass.

## What about FREE-plan reproduction?

The FREE plan is the default — you don't need to generate a license. Just
*don't* call the generator. `getActivePlan()` returns FREE when no `License`
row exists for the org (or all rows are expired).

## Security notes

- **`LANGWATCH_LICENSE_PRIVATE_KEY` is the entire trust root for the Enterprise
  surface.** Treat it like a production secret. Never commit it to the
  repo, never paste it into logs, never include it in screenshots.
- Generated licenses are bound to a specific `organizationId` — they don't
  unlock anything for other orgs on the same instance. So even if a dev
  generates a wide-window license for their dogfood org, the blast radius
  is one org on their local stack.
- The verifier uses the *public* key compiled into `signing.ts`. It does
  not touch `LANGWATCH_LICENSE_PRIVATE_KEY` at runtime — that variable is only read
  by the generator script. Production deployments should not have
  `LANGWATCH_LICENSE_PRIVATE_KEY` set in their environment.
- The generator emits a `gateway.license.created` audit row for every
  license written, so `License`-row creation is always traceable.

## What was removed

- `LANGWATCH_DEV_FORCE_ENTERPRISE` env var — gone from `env-create.mjs`,
  the four call sites that read it (`usage-stats.service.ts`,
  `presets.ts`, `composite-plan-provider.ts`, `enterprise.ts`),
  `.env.example`, and the previous ADR-018 documenting the pattern.
  Removed in `c9498004c` (5 files, +7 / −92, orphaned `PLAN_LIMITS`
  and `PlanTypes` imports also swept).
- The composite-plan-provider bypass that the env var threaded through
  is gone with it; non-SaaS installs now go through the same
  `getLicenseHandler().getActivePlan(organizationId)` path as SaaS.
- The generator script itself shipped in `6c8020462`
  (`langwatch/scripts/generate-license.ts` + `applyLicenseToOrg`
  programmatic export + `ensureOrgHasLicense` idempotent helper wired
  into `seed-gateway-dogfood.ts`).

If you find a remaining reference to `LANGWATCH_DEV_FORCE_ENTERPRISE`
anywhere in the repo, file an issue and remove it — the policy is
zero-tolerance.
