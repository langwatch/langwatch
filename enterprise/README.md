# LangWatch Enterprise

Everything under `enterprise/` is the Enterprise Edition of LangWatch.
It is **not** covered by the repository's Apache 2.0 license — it is governed by
the [LangWatch Enterprise License](./LICENSE.md).

This directory is the legal ownership root. It holds no packages of its own —
only modules, each mirroring the same shape a core module uses:

- `modules/<feature>/{contract,server,web}` — billing, licensing,
  managed-provider, saas, scim, sso, and governance. Each module's contract is
  shared, its server half is installed by `createApp` like any other module,
  and its browser half (where one exists) is installed by `createUi`.
  `modules/catalogue.json` maps every one of these subjects to its owning
  module and its `enterprise` classification; the generated module lists
  install both classifications into the same processes.

There is no separate Enterprise composition root and no conditional mounting:
Enterprise routes are always mounted and refuse per-organization on
entitlement. The licence leg is the `licenseSource` supply token, provided by
the process. See [dev/docs/ARCHITECTURE.md §11](../dev/docs/ARCHITECTURE.md)
for the shape ruling.

Billing's Stripe subscription lifecycle, usage-limit notifications, and
license-purchase workflow live in `modules/billing/process`; the application
keeps only injected provider/mail/notification adapters and route mounting.

These modules ship in every LangWatch distribution and you may run them in
production without a license: the enterprise capabilities verify a license at
runtime and stay dormant without one, and everything else in LangWatch is
unrestricted. What requires a commercial Enterprise License is using those
capabilities in production, or running a distribution whose license checks
were removed or bypassed. See [LICENSE.md](./LICENSE.md) for the exact terms,
and https://langwatch.ai/pricing or sales@langwatch.ai for a license.

Apache-licensed source is governed separately by the repository root
[`LICENSE.md`](../../LICENSE.md).
