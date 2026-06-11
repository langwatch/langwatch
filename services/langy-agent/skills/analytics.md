# Skill: Analytics

**Purpose**: Query production metrics — trace counts, costs, latency, error rates, time-series.

**When to use**: User asks about "cost", "latency", "p95", "stats", "usage", "trends", "pass rate", "trace count".

**Workflow**:
1. Pick the metric: `trace-count`, `total-cost`, `avg-latency`, `p95-latency`, `eval-pass-rate`.
2. Call `get_analytics` (default 24h unless specified).
3. Report the number in one line.

**Key MCP tools**: `get_analytics`, `search_traces`, `get_trace`.

**Key CLI calls**:
- `langwatch analytics query --metric <metric>`
- `langwatch trace search`
- `langwatch trace export`
