// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Governance call-surface tag stamped into AuditLog.metadata.surface so
 * forensic readers can answer "which surface initiated this change":
 * the dashboard (tRPC), a CI script (REST/Hono), an admin CLI command,
 * or an agent (MCP).
 *
 * Per umbrella spec @audit-uniform: every state-changing call emits a
 * row with the matching surface tag, identical payload otherwise. The
 * field is metadata-side rather than a dedicated column to avoid a
 * schema change — readers query `metadata->>'surface'`.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 */
export type GovernanceCallSurface = "trpc" | "hono" | "cli" | "mcp";

export const DEFAULT_GOVERNANCE_SURFACE: GovernanceCallSurface = "trpc";
