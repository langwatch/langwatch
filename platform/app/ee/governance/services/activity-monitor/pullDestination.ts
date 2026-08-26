// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Where a pull-mode source is allowed to send its credential.
 *
 * A pull adapter's config names a host, and the worker attaches the decrypted
 * upstream secret to every request it sends there. That makes the host field a
 * security control, not a convenience: whoever can set it decides where the
 * secret goes. It is checked on the write, not at pull time, because by pull
 * time the caller is long gone and the only signal left is a failed run.
 *
 * Scoped deliberately to the adapters whose destination is knowable. An
 * adapter that legitimately points anywhere (a customer's own HTTP audit-log
 * API) cannot be pinned this way and is left alone rather than given a check
 * that would have to be disabled immediately.
 */

import { ValidationError } from "@langwatch/handled-error";
import {
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  isDataverseEnvironmentOrigin,
} from "../pullers/dataverseEnvironment";
import {
  DATABRICKS_GENIE_ADAPTER_ID,
  isDatabricksWorkspaceOrigin,
} from "../pullers/databricksGenie.puller";

/**
 * Reject a pull config whose destination is not one this adapter may reach.
 *
 * A no-op for configs with no adapter, and for adapters that have no fixed
 * destination — silence here means "not pinnable", never "checked and fine".
 */
export function assertPullDestinationAllowed(
  parserConfig: Record<string, unknown> | null | undefined,
): void {
  if (!parserConfig || typeof parserConfig !== "object") return;

  if (parserConfig.adapter === DATABRICKS_GENIE_ADAPTER_ID) {
    const workspaceUrl = parserConfig.workspaceUrl;
    if (
      typeof workspaceUrl !== "string" ||
      !isDatabricksWorkspaceOrigin(workspaceUrl)
    ) {
      throw new ValidationError(
        "Workspace URL must be an https Databricks workspace address, ending in .azuredatabricks.net, .cloud.databricks.com or .gcp.databricks.com.",
      );
    }
  }

  if (parserConfig.adapter === COPILOT_STUDIO_DATAVERSE_ADAPTER_ID) {
    const environmentUrl = parserConfig.environmentUrl;
    if (
      typeof environmentUrl !== "string" ||
      !isDataverseEnvironmentOrigin(environmentUrl)
    ) {
      throw new ValidationError(
        "Environment URL must be an https Power Platform environment address, ending in .dynamics.com, .microsoftdynamics.us, .appsplatform.us or .dynamics.cn. Environments served from a custom domain are not supported yet — contact support.",
      );
    }
  }
}
