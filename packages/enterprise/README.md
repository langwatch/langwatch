# LangWatch Enterprise

Everything under `packages/enterprise/` is the Enterprise Edition of LangWatch.
It is **not** covered by the repository's Apache 2.0 license — it is governed by
the [LangWatch Enterprise License](./LICENSE.md).

This directory is the legal and package ownership root:

- `@langwatch/enterprise` is the portable feature catalogue.
- `composition/api`, `composition/worker`, and `composition/web` are the only
  Enterprise runtime composition roots.
- `features/<feature>/{contract,server,web}` contains each strict feature
  vertical. Licensing currently provides portable contracts and a server
  implementation; it has no separate web implementation.

Billing's Stripe subscription lifecycle, usage-limit notifications, and
license-purchase workflow live in `features/billing/server`; the application
keeps only injected provider/mail/notification adapters and route mounting.

Enterprise implementations belong in this package tree. Process-specific
composition may mount them from the applications, but application directories
do not own Enterprise feature implementations.

These modules ship in every LangWatch distribution and you may run them in
production without a license: the enterprise capabilities verify a license at
runtime and stay dormant without one, and everything else in LangWatch is
unrestricted. What requires a commercial Enterprise License is using those
capabilities in production, or running a distribution whose license checks
were removed or bypassed. See [LICENSE.md](./LICENSE.md) for the exact terms,
and https://langwatch.ai/pricing or sales@langwatch.ai for a license.

Apache-licensed source is governed separately by the repository root
[`LICENSE.md`](../../LICENSE.md).
