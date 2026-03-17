---
name: analytics
user-prompt: "How is my agent performing?"
description: Analyze your AI agent's performance using LangWatch analytics. Use when the user wants to understand costs, latency, error rates, usage trends, or debug specific traces. Works with any LangWatch-instrumented agent.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code, Claude Web, and similar AI assistants.
---

# Analyze Agent Performance with LangWatch

This skill uses LangWatch MCP tools to query and present analytics. It does NOT write code.

## Step 1: Set up the LangWatch MCP

Install the LangWatch MCP server so you have access to analytics and observability tools:

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

## Step 2: Discover Available Metrics

Before querying, discover what metrics and filters are available:

- Call `discover_schema` with category `"all"` to learn the full set of available metrics, aggregations, and filters
- Review the returned schema to understand metric names and their supported aggregations

CRITICAL: Always call `discover_schema` first. Do NOT hardcode or guess metric names.

## Step 3: Query Analytics

Use the appropriate MCP tool based on what the user needs:

### Trends and Aggregations

Use `get_analytics` for time-series data and aggregate metrics:

- **Total LLM cost for the last 7 days** -- metric `"performance.total_cost"`, aggregation `"sum"`
- **P95 latency** -- metric `"performance.completion_time"`, aggregation `"p95"`
- **Token usage over time** -- metric `"performance.total_tokens"`, aggregation `"sum"`
- **Error rate** -- metric `"metadata.error"`, aggregation `"count"`

### Finding Specific Traces

Use `search_traces` to find individual requests matching criteria:

- Traces with errors
- Traces from a specific user or session
- Traces matching a keyword or pattern

## Step 4: Inspect Individual Traces

Use `get_trace` with a trace ID to drill into details:

- View the full request/response
- See token counts and costs per span
- Inspect error messages and stack traces
- Examine individual LLM calls within a multi-step agent

## Step 5: Present Findings

Summarize the data clearly for the user:

- Lead with the key numbers they asked about
- Highlight anomalies or concerning trends (cost spikes, latency increases, error rate changes)
- Provide context by comparing to previous periods when relevant
- Suggest next steps if issues are found (e.g., "The p95 latency spiked on Tuesday -- here are the slowest traces from that day")

## Common Mistakes

- Do NOT skip `discover_schema` -- always call it first to understand available metrics before querying
- Do NOT try to write code -- this skill uses MCP tools only, no SDK installation or code changes
- Do NOT hardcode metric names -- discover them dynamically so they stay correct as the platform evolves
- Do NOT use `platform_` MCP tools for creating resources -- this skill is read-only analytics
- Do NOT present raw JSON to the user -- summarize the data in a clear, human-readable format
