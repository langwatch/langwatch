# ADR-005: Feature Flags via tRPC and PostHog

**Date:** 2026-01-29

**Status:** Accepted

## Context

We need feature flags to control UI features, enable gradual rollouts, and provide kill switches for the LangWatch platform. The system must support flexible targeting at multiple levels:

- **User-level**: Flags for specific users (beta testers, internal team)
- **Project-level**: Flags for specific projects
- **Organization-level**: Flags for entire organizations

Previous approaches using email-based checks (e.g., `email?.endsWith("@langwatch.ai")`) were inflexible. We needed a solution that:

- Integrates with our existing PostHog setup
- Provides fast kill switch response (sub-5-second propagation)
- Works reliably even when PostHog is unavailable
- Supports local development without PostHog

## Decision

We implement feature flags using a tRPC endpoint backed by PostHog with a hybrid Redis/memory caching layer.

### Architecture Flow

```
Component
    |
    v
useFeatureFlag (React Query, 5s staleTime)
    |
    v
tRPC endpoint: featureFlag.isEnabled
    |
    v
FeatureFlagService (env override check)
    |
    v
FeatureFlagServicePostHog
    |
    v
StaleWhileRevalidateCache (Redis -> Memory fallback)
    |
    v
PostHog API (on cache miss)
```

### Key Components

1. **`useFeatureFlag` hook**: React hook that calls tRPC with React Query caching.

2. **`featureFlag.isEnabled` tRPC endpoint**: Protected endpoint that checks flags server-side. Only flags in `FRONTEND_FEATURE_FLAGS` can be queried.

3. **`FeatureFlagService`**: Main service that checks env overrides first, then delegates to PostHog or memory service.

4. **`FeatureFlagServicePostHog`**: PostHog integration with hybrid caching.

5. **`StaleWhileRevalidateCache`**: Redis-first cache with in-memory fallback.

### Targeting via personProperties

Flags target users, projects, or organizations using PostHog `personProperties`:

```typescript
await featureFlagService.isEnabled(
  "release_ui_simulations_menu_enabled",
  userId,
  false,
  {
    projectId: "proj_123",
    organizationId: "org_456",
  }
);
```

PostHog receives these as `personProperties.project_id` and `personProperties.organization_id` for release condition evaluation.

### Caching Strategy

A 5-second TTL (`FEATURE_FLAG_CACHE_TTL_MS`) is used at two levels:

1. **Server-side**: `StaleWhileRevalidateCache` with Redis (shared) + memory (per-instance)
2. **Client-side**: React Query `staleTime`

Cache key format: `{flagKey}:{distinctId}:{projectId}:{organizationId}`

### Flag Naming Convention

Pattern: `{type}_{area}_{feature}_{descriptor}`

| Type | Purpose |
|------|---------|
| `release` | New feature rollout |
| `experiment` | A/B test |
| `permission` | Access control |
| `ops` | Operational/kill switch |

| Area | System part |
|------|-------------|
| `ui` | Frontend/UI features |
| `api` | API endpoints |
| `es` | Event sourcing |
| `worker` | Background workers |

Examples:
- `release_ui_simulations_menu_enabled` - UI feature rollout
- `ops_worker_trace_processing_killswitch` - Kill switch for workers

### Environment Overrides

Flags can be force-enabled/disabled via environment variables:
- `RELEASE_UI_SIMULATIONS_MENU_ENABLED=1` - Force enable
- `RELEASE_UI_SIMULATIONS_MENU_ENABLED=0` - Force disable

Env overrides take precedence over PostHog.

### Adding New Flags

1. Create the flag in PostHog with release conditions
2. Add the flag key to `FRONTEND_FEATURE_FLAGS` array
3. Use `useFeatureFlag("your_flag_key")` in components

```typescript
// In frontendFeatureFlags.ts
export const FRONTEND_FEATURE_FLAGS = [
  "release_ui_simulations_menu_enabled",
  "your_new_flag_here",
] as const;

// In your component
const { enabled, isLoading } = useFeatureFlag("your_new_flag_here", {
  projectId: project.id, // Optional targeting
});
```

## Rationale / Trade-offs

**Why tRPC instead of session-based:**
- Flags can be refreshed without re-authentication
- Supports dynamic targeting (project/org can change without logout)
- Cleaner separation of concerns
- React Query provides built-in loading states and caching

**Why 5-second TTL:**
- Fast enough for kill switches (changes propagate in <5s)
- Low enough API overhead (one call per 5s per unique key)
- Good balance between freshness and performance

**Why Redis + memory hybrid:**
- Redis provides cross-instance cache sharing
- Memory fallback ensures resilience when Redis is down
- Zero configuration for local development (memory-only)

**Trade-offs accepted:**
- Slight delay (up to 5s) for flag changes to propagate
- Additional network call on cache miss
- React Query bundle size (already used elsewhere)

## Consequences

**Positive:**
- Flexible targeting at user/project/org level via PostHog
- Fast kill switch response (5s max)
- Resilient to PostHog/Redis outages
- Type-safe flag names with `FrontendFeatureFlag` type
- Local development works without PostHog (env overrides or memory fallback)

**Negative:**
- Extra network round-trip on first load (mitigated by caching)
- Two caching layers to reason about (React Query + server cache)

**Neutral:**
- PostHog is required for production flag evaluation
- New flags require code changes (adding to `FRONTEND_FEATURE_FLAGS`)

## Default Value Strategy

The `isEnabled` method accepts a `defaultValue` parameter:

| Default | Use case |
|---------|----------|
| `false` (fail-closed) | New features, experimental UI, paid features |
| `true` (fail-open) | Kill switches that disable functionality when enabled |

The tRPC endpoint uses `defaultValue = false` (fail-closed), meaning new UI features stay hidden if PostHog fails.

## References

- PostHog feature flags: https://posthog.com/docs/feature-flags
- tRPC: https://trpc.io/
- React Query: https://tanstack.com/query
