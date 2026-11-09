/**
 * The deployment a stored mapping names for a model, keyed bare (`gpt-4o`) or
 * qualified (`azure/gpt-4o`). Execution and the credential probe both read it here.
 */
export function deploymentForModel({
  deploymentMapping,
  qualifiedModel,
}: {
  deploymentMapping: Record<string, string> | null | undefined;
  qualifiedModel: string;
}): string | null {
  if (!deploymentMapping) return null;
  const bareModel = qualifiedModel.split("/").slice(1).join("/");
  return deploymentMapping[bareModel] ?? deploymentMapping[qualifiedModel] ?? null;
}
