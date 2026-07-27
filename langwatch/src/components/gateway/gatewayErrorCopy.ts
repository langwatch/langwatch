/**
 * Human copy for the gateway control plane's coded errors. The server
 * speaks in stable `snake_case:` prefixes so scripts can match on them;
 * people get the sentence that says what to do instead.
 */
const ERROR_COPY: Array<{ code: string; copy: string }> = [
  {
    code: "trace_project_required",
    copy: "This key needs a project for its traces and costs to land in. Pick one under Ownership.",
  },
  {
    code: "providers_allowed_empty",
    copy: "Select at least one provider, or allow all providers.",
  },
  {
    code: "providers_not_in_scope",
    copy: "A selected provider is not reachable from this key's ownership. Uncheck it or change the ownership.",
  },
  {
    code: "routing_policy_required",
    copy: "Pick a routing policy for this routing choice.",
  },
  {
    code: "routing_policy_conflict",
    copy: "The routing choice and the routing policy contradict each other. Pick one routing option.",
  },
  {
    code: "group_budget_requires_clickhouse",
    copy: "Group budgets track spend per member, which this deployment cannot do yet: it needs the ClickHouse spend ledger.",
  },
  {
    code: "provider_not_in_organization",
    copy: "The provider filter must name a model provider configured in this organization.",
  },
  {
    code: "scope_org_mismatch",
    copy: "One of the selected scopes belongs to a different organization.",
  },
];

export function humanizeGatewayError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  for (const { code, copy } of ERROR_COPY) {
    if (message.includes(code)) return copy;
  }
  return message || fallback;
}
