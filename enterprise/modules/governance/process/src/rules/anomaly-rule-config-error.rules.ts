// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
type ConfigIssue = { readonly message: string; readonly path: readonly PropertyKey[] };

/** Main's complaint for a rule config that fails its schema, naming which config and rule type. */
export function anomalyRuleConfigComplaint({
  issues,
  ruleType,
}: {
  issues: readonly ConfigIssue[];
  ruleType?: string;
}): string {
  const isDestinationConfig = issues.some((issue) =>
    issue.path.some((segment) => segment === "destinations"),
  );
  const configName = isDestinationConfig ? "destinationConfig" : "thresholdConfig";
  const forRuleType = !isDestinationConfig && ruleType ? ` for ${ruleType}` : "";
  return `Invalid ${configName}${forRuleType}: ${issues.map((issue) => issue.message).join("; ")}`;
}
