/**
 * What an audit row says about a call beyond its arguments: which scopes it
 * named, which resource it produced, and whether it is worth recording at all.
 */

export function auditScopeIds(input: unknown): {
  organizationId: string | undefined;
  projectId: string | undefined;
} {
  if (typeof input !== "object" || input === null) {
    return { organizationId: undefined, projectId: undefined };
  }

  const record = input as Record<string, unknown>;
  return {
    organizationId: typeof record.organizationId === "string" ? record.organizationId : undefined,
    projectId: typeof record.projectId === "string" ? record.projectId : undefined,
  };
}

/**
 * Mutations that fire on a heartbeat / per-tab cadence and aren't worth
 * recording in the audit log. `presence.*` runs every ~15s per open tab
 * (heartbeat + cursor broadcasts + leave on pagehide); auditing them
 * buries every genuine action — project edits, deletions, role changes —
 * under a wall of `presence.update` rows. They're already silenced from
 * the request log via SILENCED_LOG_PATH_PREFIXES; this is the audit-log
 * equivalent.
 *
 * Add new entries here when a router's mutations exist purely for
 * ephemeral session state that doesn't need a permanent forensic record.
 */
const AUDIT_LOG_EXEMPT_PATHS = new Set(["user.updateLastLogin"]);
const AUDIT_LOG_EXEMPT_PATH_PREFIXES = ["presence."] as const;

export function isAuditLogExempt(path: string): boolean {
  if (AUDIT_LOG_EXEMPT_PATHS.has(path)) return true;
  return AUDIT_LOG_EXEMPT_PATH_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Pull the resource ID + kind from a tRPC mutation result so the audit
 * row's `targetId` / `targetKind` columns are populated. Without this,
 * the audit log shows an empty Target column for Platform-side rows
 * (Ariana caught this on the γ post-dogfood UI bug-bash — admin
 * auditing "what did I just create?" couldn't see the new resource id
 * on their own click's audit row, only on the gateway-side mirror row).
 *
 * Best-effort: tries common shapes (id at root, .source.id, .{tail}.id
 * where tail is the resource name from the path), and derives kind
 * from the path's leading segment via a small map. Returns nulls
 * when the result shape isn't one we know — leaving the columns blank
 * is fine, that's the legacy behavior.
 */
export function deriveAuditTarget(
  path: string,
  data: unknown,
): { targetKind?: string; targetId?: string } {
  if (!data || typeof data !== "object") return {};
  const root = path.split(".")[0] ?? "";
  // Path-prefix → targetKind. Mirrors the gateway adapter's
  // GATEWAY_AUDIT_TARGET_KINDS where applicable; new platform-side
  // resources land here.
  const TARGET_KIND_BY_ROUTER: Record<string, string> = {
    gatewayBudgets: "budget",
    virtualKeys: "virtual_key",
    personalVirtualKeys: "virtual_key",
    gatewayProviders: "provider_binding",
    cacheRules: "cache_rule",
    ingestionSources: "ingestion_source",
    anomalyRules: "anomaly_rule",
    routingPolicy: "routing_policy",
    aiTools: "ai_tool_entry",
    aiToolsCatalog: "ai_tool_entry",
    organization: "organization",
    project: "project",
    team: "team",
    user: "user",
  };
  const targetKind = TARGET_KIND_BY_ROUTER[root];
  // Best-effort id extraction. Mutations return one of:
  //   1. entity directly ({ id })
  //   2. wrapped ({ source: { id } }, { budget: { id } })
  //   3. tuple with one-shot secret ({ source, ingestSecret })
  //   4. array of entities ([{ id }, ...]) — bulk creates
  //   5. array of wrapped ([{ invite: { id } }, ...]) — createInvites shape
  //   6. wrapped array ({ invites: [{ id }] }) — alt bulk shape
  // First non-empty id wins; ok to log only the first when many exist
  // (the args column already shows the input — Target is a navigation
  // anchor, not a complete inventory).
  const firstId = findFirstId(data);
  return firstId ? { targetKind, targetId: firstId } : { targetKind };
}

/**
 * One entry of a named field's array: its own `id`, or the `id` of a single
 * object one level inside it — the `{ invites: [{ invite: { id } }] }` shape.
 * Named rather than nested inline so the walk below stays readable.
 */
function findIdInArrayEntry(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const itemId = (item as Record<string, unknown>).id;
  if (typeof itemId === "string") return itemId;
  for (const innerKey of Object.keys(item)) {
    const inner = (item as Record<string, unknown>)[innerKey];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const innerId = (inner as Record<string, unknown>).id;
      if (typeof innerId === "string") return innerId;
    }
  }
  return undefined;
}

function findFirstId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findFirstId(item);
      if (id) return id;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === "string") return obj.id;
  // One level of named-field walk into objects + arrays. We don't
  // recurse arbitrarily deep — the audit Target column is best-effort,
  // and an unbounded walk would surface unrelated ids buried in nested
  // payloads.
  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const id = findIdInArrayEntry(item);
        if (id) return id;
      }
    } else if (child && typeof child === "object") {
      const childId = (child as Record<string, unknown>).id;
      if (typeof childId === "string") return childId;
    }
  }
  return undefined;
}
