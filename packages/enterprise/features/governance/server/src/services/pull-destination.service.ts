import { GovernanceValidationError } from "@langwatch/enterprise-governance-contract";
import {
  DATABRICKS_GENIE_ADAPTER_ID,
  DATABRICKS_WORKSPACE_HOST_SUFFIXES,
  isDatabricksWorkspaceOrigin,
} from "../adapters/databricks-genie-puller.adapter";

/**
 * Where a pull is allowed to send a credential.
 *
 * This runs when a source is SAVED, which is deliberately the only place it
 * runs: the rejection has to reach whoever is making the change, and the
 * adapter still has to be pointable at a local fixture by its own tests.
 *
 * The rule itself lives with the adapter, next to the reasoning for it, and is
 * called from here rather than restated. It used to be written twice — a URL
 * parse there and a regex here — and only the regex ever ran, so the copy
 * explaining why the check exists was the copy with no callers.
 */
export class PullDestinationService {
  static create(): PullDestinationService {
    return new PullDestinationService();
  }

  assertAllowed(parserConfig: Record<string, unknown> | null | undefined): void {
    if (!parserConfig || typeof parserConfig !== "object") return;
    if (parserConfig.adapter !== DATABRICKS_GENIE_ADAPTER_ID) return;
    if (
      typeof parserConfig.workspaceUrl !== "string" ||
      !isDatabricksWorkspaceOrigin(parserConfig.workspaceUrl)
    ) {
      const message = `Workspace URL must be an https Databricks workspace address, ending in ${PullDestinationService.allowedSuffixes()}.`;
      throw new GovernanceValidationError(message, {
        formErrors: [message],
      });
    }
  }

  /**
   * The allowed suffixes as the customer reads them: "a, b or c".
   *
   * Built from the list the check uses, so a new cloud cannot be added to the
   * rule and left out of what the admin is told to type instead.
   */
  private static allowedSuffixes(): string {
    const suffixes = [...DATABRICKS_WORKSPACE_HOST_SUFFIXES];
    const last = suffixes.pop();

    return suffixes.length === 0 ? (last ?? "") : `${suffixes.join(", ")} or ${last}`;
  }
}
