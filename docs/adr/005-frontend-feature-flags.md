# ADR-005: Frontend Feature Flags via Session

**Date:** 2026-01-27

**Status:** Accepted

## Context

We need to expose feature flags to the frontend to control UI elements like the Scenarios menu. Previously, this was done with email-based checks (e.g., `email?.endsWith("@langwatch.ai")`), which is inflexible and doesn't leverage our existing PostHog-based feature flag system.

The challenge is exposing backend feature flags to the frontend without:
- Causing UI flash on initial page load (if fetched client-side)
- Duplicating feature flag logic between backend and frontend
- Creating a complex new API surface

## Decision

We will expose feature flags to the frontend through the NextAuth session:

1. **Define frontend flags constant**: A `FRONTEND_FEATURE_FLAGS` constant in `src/server/featureFlag/index.ts` lists which flags should be exposed to the frontend.

2. **Check flags in session callback**: The NextAuth session callback checks each flag using the existing `featureFlagService.isEnabled()` method and adds enabled flags to the session.

3. **Use user.id as distinctId**: Consistent with existing usage, we use `user.id` (not email) as the PostHog distinctId for feature flag evaluation.

4. **Access via session.user.enabledFeatures**: Frontend components check `session?.user?.enabledFeatures?.includes("FLAG_NAME")` for user-level flags.

5. **Project-level flags with PostHog groups**: For project-scoped feature flags:
   - The session callback fetches all user projects and checks flags with PostHog groups
   - Access via `session?.user?.projectFeatures?.[projectId]?.includes("FLAG_NAME")`
   - Use `useHasFeature()(flag, projectId)` hook for project-level checks
   - PostHog groups are passed as `{ project: projectId }` to `isEnabled()`

6. **Environment variable overrides**: Flags can be force-enabled or force-disabled via environment variables, bypassing PostHog:
   - `FLAG_NAME=1` - force enable (e.g., `UI_SIMULATIONS_SCENARIOS=1`)
   - `FLAG_NAME=0` - force disable
   - Flag name is uppercased with dashes replaced by underscores

## Rationale / Trade-offs

**Why session instead of client-side fetch:**
- Session data is available immediately on page load via SSR
- No flash of content as flags load
- No additional API calls from the frontend

**Why a constant for frontend flags:**
- Not all backend flags need frontend exposure
- Explicit list prevents accidental exposure of internal flags
- Type safety with `FrontendFeatureFlag` type

**Why user.id for distinctId:**
- Matches existing PostHog tracking patterns
- Consistent with how other feature flags are evaluated
- User IDs are stable (emails can change)

**Why PostHog groups for project-level flags:**
- PostHog natively supports groups for multi-tenancy
- Enables targeting flags to specific projects without custom logic
- Cache key includes project ID for proper isolation

**Trade-offs accepted:**
- All frontend flags are checked on every session callback (minor performance overhead)
- Slight increase in session size
- Project-level flags multiply PostHog calls (projects x flags), mitigated by parallel execution and caching

## Consequences

**Positive:**
- Frontend can use the same PostHog feature flags as backend
- No UI flash on initial load
- Centralized feature flag management
- Type-safe flag names
- Feature flag changes are picked up on next page load (session callback runs on each session check)
- Project-level targeting via PostHog groups

**Neutral:**
- Session object grows slightly with `enabledFeatures` and `projectFeatures`
- New pattern for frontend feature flags (may require documentation)

## References

- PostHog feature flags documentation
- PostHog groups documentation
- NextAuth.js session callback documentation
