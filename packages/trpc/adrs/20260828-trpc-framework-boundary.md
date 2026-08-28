# tRPC framework boundary

**Date:** 2026-08-28

**Status:** Proposed

## Decision

`@langwatch/trpc` owns generic typed tRPC root construction. It depends only
on `@trpc/server` and does not choose authentication, authorization, audit,
tracing, persistence, feature services, error presentation, or process
composition. A process root constructs one typed root and owns all middleware
policy. AuthZ continues to own authorization declarations and decisions.
