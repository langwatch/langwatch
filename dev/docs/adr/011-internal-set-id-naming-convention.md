# ADR-011: Internal Set ID Naming Convention

**Date:** 2026-03-13

**Status:** Accepted

## Context

LangWatch uses "scenario sets" to group related scenario runs. Sets can originate from:

1. **User-created sets** -- arbitrary names provided via SDK (e.g., `"nightly-ci"`, `"production-tests"`)
2. **On-platform sets** -- created by the LangWatch UI when running scenarios directly
3. **Suite sets** -- created by the evaluation suite system

Without a namespace convention, internal sets could collide with user-created set names. The platform also needs to detect internal sets for UI rendering (friendly names, icons, sorting) and for query filtering (e.g., excluding internal sets from external set listings).

Multiple parts of the codebase were using hardcoded `"__internal__"` string checks instead of centralised utilities, creating maintenance risk and inconsistency.

## Decision

We will use a structured naming convention for all internal set IDs:

- **Prefix:** `__internal__` -- identifies any platform-managed set
- **On-platform pattern:** `__internal__${projectId}__on-platform-scenarios`
- **Suite pattern:** `__internal__${suiteId}__suite`

All detection logic is centralised in two utility modules:

- `src/server/scenarios/internal-set-id.ts` -- exports `INTERNAL_SET_PREFIX`, `ON_PLATFORM_SET_SUFFIX`, `ON_PLATFORM_DISPLAY_NAME`, `isInternalSetId()`, `isOnPlatformSet()`, `getOnPlatformSetId()`
- `src/server/suites/suite-set-id.ts` -- exports `SUITE_SET_SUFFIX`, `isSuiteSetId()`, `getSuiteSetId()`, `extractSuiteId()`

Detection functions validate **both prefix and suffix** to prevent false positives from user-created sets that happen to end with an internal suffix.

All code that needs to distinguish internal from external sets must use these utilities and constants rather than hardcoded string literals.

## Consequences

- **Positive:** Single source of truth for the naming convention, reducing the risk of bugs from hardcoded strings drifting out of sync.
- **Positive:** Detection functions checking both prefix and suffix prevent false positives (e.g., a user set named `"my-set__on-platform-scenarios"` is correctly identified as external).
- **Positive:** UI components can reliably resolve friendly display names (e.g., "On-Platform Scenarios") instead of leaking raw internal IDs.
- **Negative:** Adding a new internal set type requires adding a new suffix constant and detection function, but this is a low-frequency change.
- **Neutral:** The `__internal__` prefix is a reserved namespace; users are implicitly prevented from creating sets with this prefix via SDK validation (not yet enforced at ingestion).

## References

- Feature spec: `specs/scenarios/internal-set-namespace.feature`
- Utility modules: `src/server/scenarios/internal-set-id.ts`, `src/server/suites/suite-set-id.ts`
- Related issue: #2344
