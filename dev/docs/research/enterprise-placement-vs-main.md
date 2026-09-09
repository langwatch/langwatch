# Enterprise placement compared with main

Compared on 2026-09-07 against local `main` (`7fb95fe904`, August 18) and the
newer locally available `origin/main` (`8b51631777`, September 7). No fetch was
needed. The old root was `platform/app/ee`; the new root is
`enterprise`. The newer snapshot contains 451 files under `ee`,
including 236 production TypeScript files after excluding tests.

The check combined Git rename matches, exported-symbol searches, source reads
and the accepted ownership decisions. Rewritten methods and dynamic imports
are not exhaustively resolved by symbol matching. This is a placement review,
not proof that every old route and entitlement behaves identically.

| Old Enterprise domain          | Current owner                             | Assessment                                                                                           |
| ------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Admin/backoffice/impersonation | Core Ops                                  | Explicit change in ADR-112; not accidental                                                           |
| Audit log writer               | Core AuditLog                             | Current requested change, ADR-134; direct history readers still need migration                       |
| Billing                        | Enterprise Billing                        | Retained; portable plan values also live in core Entitlement                                         |
| Enterprise event-sourcing      | Enterprise Governance                     | Pulled-usage and ingestion-pull commands, processes and projections remain Enterprise                |
| Governance                     | Enterprise Governance                     | Policy, ingestion sources, pulls, departments and tool-catalogue ownership retained; exception below |
| Licensing                      | Enterprise Licensing                      | Validation/signing implementation retained                                                           |
| Managed providers              | Enterprise Managed Provider               | Retained                                                                                             |
| SaaS                           | Enterprise SaaS                           | Browser implementation retained; no server installer needed                                          |
| SCIM                           | Enterprise SCIM                           | Provisioning implementation retained; core Identity owns identity ledger facts                       |
| SSO                            | Enterprise SSO plus core Auth integration | License gate service retained; path predicates and account matching moved to core Auth               |
| Webhooks                       | Core Webhook                              | Explicit current request, ADR-134; product entitlement gates retained                                |

## Placement correction

The original `modules/trace/server/src/rules/ingest-key-provenance.rules.ts`
was in core Trace but retained `SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise`.
Git identifies it as a 93% similar move of
`platform/app/ee/governance/services/ingestKeyProvenance.utils.ts`.
The implementation contains source classification, non-billable attribution
and Copilot scope policy as well as generic authenticated-key stamping.
The working-tree correction places source and billing policy in
[Enterprise Governance](../../../enterprise/modules/governance/server/src/rules/ingest-key-provenance.rules.ts)
and generic attribute protection in [OTLP](../../../packages/otlp/src/receiver-policy.ts).
Composition resolves declarative policy through Governance's existing complete
contract. The authenticated key is stamped last so policy cannot erase it.

Governance still needs its complete Feature API/installer migration. Deployments
that do not compose Governance continue to refuse ingestion-source keys with
503; this correction does not make the default deployment complete. See the
[receiver policy spec](../../../specs/server/otlp-receiver-policy.feature).

## Moves with qualifications

Core Auth now owns `sso-matching.ts` and `sso-path-gate.ts`, formerly under
`ee/sso`. These are integration helpers, not the license evaluator. The
Enterprise `SsoGateService` still evaluates licenses, and the Better Auth
adapter still rejects gated requests with `SSO_LICENSE_REQUIRED`. This review
does not change the separate auth/identity/SSO work.

Personal workspace implementation moved from Governance to core Organization,
and project primitives moved to core Project. ADR-112 explicitly assigns those
domains to their core owners. Core User web also duplicates AI-tool catalogue
DTOs; that is contract duplication to remove, not evidence that the governed
catalogue service moved out of Enterprise.

AuditLog's shared writer moving to core does not make every history surface
unlicensed. The old Enterprise license explicitly distinguished background
recording from use of Enterprise history. Preserve each existing consumer's
policy while migrating direct readers and transactional writes.

## Architecture adoption is a separate unresolved issue

Billing, Governance, SCIM and SSO lack canonical `<feature>.api.ts` contracts
and `defineFeature(...).withApp(...)` installers. Licensing has both but fails
the App-surface lint. Managed Provider has an API token/interface in its old
service file and an installer, so its canonical contract check fails. These
are already lint failures, not Enterprise exemptions. SaaS is browser-only.

The catalogue ADR/spec still listed AuditLog and Webhook as Enterprise before
this review; those lists are updated to the accepted core placement.
