# ADR-005: Feature flags via PostHog

**Date:** 2026-01-29

**Status:** Superseded by
[`feature-flag/adrs/001`](../../../packages/features/feature-flag/adrs/001-feature-flag-service-boundary.md)

This ADR introduced registered SYSTEM and PRODUCT flags, with PostHog handling
product targeting and a separate local path for operational switches. That
split later left resolution spread across a global app service, PostHog,
environment reads and browser overrides.

The current decision is owned beside the singular `feature-flag` feature. It
keeps the useful in-code registry and operator controls, removes PostHog from
resolution, parses environment overrides once at boot, and exposes one
composed service for backend, transport and browser callers.
