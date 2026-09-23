# ADR-002: `saas` is the LangWatch Cloud module

**Status:** Accepted (2026-09-23)

**Amends:** [ADR-001](./001-saas-package-boundary.md), which said no server
package is part of this feature.

**Behavioural contract:**
[the usage-report receiver](../specs/usage-report-receiver.feature)

## Context

Some routes exist only for LangWatch itself: the daily usage report every
self-hosted install posts is received by Cloud and nobody else. Each such
route used to consult the process's `isSaas` flag on its own, so the claim
"this deployment is LangWatch Cloud" was made in many places.

## Decision

`enterprise/modules/saas` gains a process half,
`@langwatch/enterprise-saas-process`, and it is the one place that asserts
the deployment is LangWatch Cloud. `LangWatchCloudService` reads the
process's `isSaas` fact (owned by `packages/process-server`; this module
never declares `IS_SAAS`) and refuses everything else with
`LangWatchCloudOnlyError` (`langwatch_cloud_only`, 404).

Routes that only Cloud answers live here, always mounted, refusing off Cloud.
The first is the usage-report receiver: `POST /api/track_usage` (the legacy
address every open-source install posts to) and `POST /api/v1/connect/stats`
(the connect host), one operation behind both. It records through
`LicensingApi.recordUsageReport` and sends product analytics through its own
channel, targeted by `OpsApi.findProductAnalyticsTargets()`.

## Consequences

The boolean is a stand-in. The claim should later be proven by a signed
licence rather than a flag; keeping the assertion in this one service makes
that swap one change.
