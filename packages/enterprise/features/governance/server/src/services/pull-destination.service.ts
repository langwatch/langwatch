const DATABRICKS_GENIE_ADAPTER_ID = "databricks_genie";
const DATABRICKS_HOST_SUFFIXES = [
  ".azuredatabricks.net",
  ".cloud.databricks.com",
  ".gcp.databricks.com",
] as const;

export class PullDestinationService {
  static create(): PullDestinationService {
    return new PullDestinationService();
  }

  assertAllowed(
    parserConfig: Record<string, unknown> | null | undefined,
  ): void {
    if (!parserConfig || typeof parserConfig !== "object") return;
    if (parserConfig.adapter !== DATABRICKS_GENIE_ADAPTER_ID) return;
    if (
      typeof parserConfig.workspaceUrl !== "string" ||
      !this.isDatabricksWorkspaceOrigin(parserConfig.workspaceUrl)
    ) {
      throw new Error(
        "Workspace URL must be an https Databricks workspace address, ending in .azuredatabricks.net, .cloud.databricks.com or .gcp.databricks.com.",
      );
    }
  }

  isDatabricksWorkspaceOrigin(value: string): boolean {
    const match = /^https:\/\/([a-z0-9.-]+)\/?$/i.exec(value);
    if (!match?.[1]) return false;
    return DATABRICKS_HOST_SUFFIXES.some((suffix) =>
      match[1]!.toLowerCase().endsWith(suffix),
    );
  }
}
