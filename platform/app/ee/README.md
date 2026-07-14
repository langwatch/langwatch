# LangWatch Enterprise Modules

Everything under `langwatch/ee/` is the Enterprise Edition of LangWatch. It is
**not** covered by the repository's Apache 2.0 license — it is governed by the
[LangWatch Enterprise License](./LICENSE.md).

Modules typically live here:

- `admin/` — back-office tooling and impersonation
- `billing/` — Stripe, plan limits, subscription flows
- `licensing/` — license generation, plan mapping, license validation
- `managed-providers/` — managed LLM provider integrations
- `saas/` — SaaS-only surfaces

Free use of these modules is allowed for local development, evaluation, and
automated testing. **Production use requires a commercial Enterprise License**
— see https://langwatch.ai/pricing or contact sales@langwatch.ai.

Everything outside this directory is Apache 2.0 — see the repository root
[`LICENSE.md`](../../LICENSE.md).
