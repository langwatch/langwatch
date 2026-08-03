# LangWatch Enterprise Modules

Everything under `langwatch/ee/` is the Enterprise Edition of LangWatch. It is
**not** covered by the repository's Apache 2.0 license, it is governed by the
[LangWatch Enterprise License](./LICENSE.md).

Modules that live here:

- `admin/` — back-office tooling and impersonation
- `audit-log/` — the audit trail write path
- `billing/` — Stripe, plan limits, subscription flows
- `event-sourcing/` — enterprise event-sourcing pipelines
- `governance/` — AI governance surfaces
- `licensing/` — license generation, plan mapping, license validation
- `managed-providers/` — managed LLM provider integrations
- `saas/` — SaaS-only surfaces
- `scim/` — SCIM v2 provisioning API and token management
- `sso/` — identity-provider wiring and the license gate for SSO

These modules ship in every LangWatch distribution and you may run them in
production without a license: the enterprise capabilities verify a license at
runtime and stay dormant without one, and everything else in LangWatch is
unrestricted. What requires a commercial Enterprise License is using those
capabilities in production, or running a distribution whose license checks
were removed or bypassed. See [LICENSE.md](./LICENSE.md) for the exact terms,
and https://langwatch.ai/pricing or sales@langwatch.ai for a license.

Everything outside this directory is Apache 2.0, see the repository root
[`LICENSE.md`](../../LICENSE.md).
