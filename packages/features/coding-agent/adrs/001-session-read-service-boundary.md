# ADR-001: Coding Agent has one session-read service

**Status:** Accepted

**Behavioural contract:** [Coding-agent session reads](../specs/coding-agent-session-read.feature)

Coding Agent owns its durable session aggregate, trace-to-session mapping,
metric-series overlay and ordered session-event read model. The portable
contract exports one Zod 4 `CodingAgentService`; the server package implements
it with private repositories, composed once at application boot.

`listRecent` is part of that complete service rather than a GitHub-specific
branch lookup. GitHub consumes it to backfill pull-request mappings, while
GitHub retains ownership of installations, pull requests and mapping lifecycle.
Trace owns transcript rendering and canonical trace content, so neither content
nor trace repositories cross into this feature.

Coding Agent also owns browser-safe presentation of its session and pull-request
reads. Reusable row shaping, sorting, status derivation, formatting and small UI
primitives live in the feature web package. The application retains page,
router, query and drawer composition; the web package imports neither the app
nor the server package.

The service validates every input, preserves the aggregate's complete existing
row shape, applies metric-series values only to zero folded totals, and treats
trace-session discovery as genuinely optional (`tryGet*`). It has no
environment reads, route registration or process-global database access.
