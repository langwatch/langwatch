# GitNexus Spike Results

**Issue**: #2804 — SPIKE: GitNexus — prevent agents from duplicating existing code
**Date**: 2026-03-31
**Version tested**: GitNexus v1.4.10

## Summary

GitNexus's core value proposition works — its `query` and `context` tools help agents discover existing code before duplicating it (3/4 tests passed). However, the PolyForm Noncommercial license blocks commercial use, and the integration is too opinionated for our workflow.

**Verdict: Do not adopt in current form.**

## Key Metrics

| Metric | Value |
|--------|-------|
| Index time | 37.3s |
| Index size | 160MB |
| Symbols indexed | 21,231 |
| Relationships | 53,497 |
| Leiden clusters | 875 (715 unique) |
| Execution flows | 300 |
| Query latency (cold) | 0.8-1.7s |
| Token overhead | ~2,774 tokens/conversation |
| License | PolyForm Noncommercial 1.0.0 |

## Duplication Prevention Test Results

| Test | Task | Result |
|------|------|--------|
| A | Add a new prompt label type | PASS — found PromptVersionLabelRepository |
| B | Write a formatDate utility | PASS — found both existing implementations |
| C | Build a trace search function | PASS — found ElasticsearchTraceService + ClickHouseTraceService |
| D | Fetch project settings | PARTIAL — results scattered, semantic matching limited |

## Blockers

1. **License**: PolyForm Noncommercial — hard blocker for commercial use
2. **Token overhead**: 2,774 tokens of aggressive MUST/NEVER instructions
3. **Cluster quality**: 875 micro-communities with heavy label duplication
4. **Index size**: 160MB per worktree
5. **Opinionated integration**: Auto-modifies CLAUDE.md and AGENTS.md

## Recommended Alternatives

1. Enhance feature-map.json with utility function registries
2. PreToolUse hook for Grep/Glob to search before writing
3. Domain ownership table in AGENTS.md
4. Revisit if license terms change
