// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceConfig } from "@langwatch/enterprise-governance-contract";

/** Where each pulled vendor is reached, each without a trailing slash. */
export type VendorBases = Readonly<{
  openAiAdmin: string;
  anthropicAdmin: string;
  microsoftLogin: string;
  microsoftGraph: string;
  /** The one Databricks workspace origin accepted beside the three clouds, when one is named. */
  databricksWorkspace: string | undefined;
  /** The one Dataverse environment address accepted beside the real Dynamics clouds, when one is named. */
  dataverseEnvironment: string | undefined;
}>;

export const REAL_VENDOR_BASES: VendorBases = {
  openAiAdmin: "https://api.openai.com",
  anthropicAdmin: "https://api.anthropic.com",
  microsoftLogin: "https://login.microsoftonline.com",
  microsoftGraph: "https://graph.microsoft.com",
  databricksWorkspace: undefined,
  dataverseEnvironment: undefined,
};

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** The configured bases; a leaf that is unset or blank is the real vendor. */
export function vendorBasesOf({
  config,
}: {
  config:
    | Pick<
        GovernanceConfig,
        | "openAiAdminApiBase"
        | "anthropicAdminApiBase"
        | "microsoftLoginBase"
        | "microsoftGraphApiBase"
        | "databricksWorkspaceBase"
        | "dataverseEnvironmentBase"
      >
    | undefined;
}): VendorBases {
  const pick = (value: string | undefined, real: string) =>
    value ? withoutTrailingSlash(value) : real;
  return {
    openAiAdmin: pick(config?.openAiAdminApiBase, REAL_VENDOR_BASES.openAiAdmin),
    anthropicAdmin: pick(config?.anthropicAdminApiBase, REAL_VENDOR_BASES.anthropicAdmin),
    microsoftLogin: pick(config?.microsoftLoginBase, REAL_VENDOR_BASES.microsoftLogin),
    microsoftGraph: pick(config?.microsoftGraphApiBase, REAL_VENDOR_BASES.microsoftGraph),
    databricksWorkspace: config?.databricksWorkspaceBase
      ? withoutTrailingSlash(config.databricksWorkspaceBase)
      : undefined,
    dataverseEnvironment: config?.dataverseEnvironmentBase
      ? withoutTrailingSlash(config.dataverseEnvironmentBase)
      : undefined,
  };
}

/**
 * The origins the local-address fence lets through: a configured base that is not the real
 * vendor. Nothing else is exempt.
 */
export function exemptOriginsOf({ bases }: { bases: VendorBases }): string[] {
  const configured = [
    bases.openAiAdmin,
    bases.anthropicAdmin,
    bases.microsoftLogin,
    bases.microsoftGraph,
    bases.databricksWorkspace,
    bases.dataverseEnvironment,
  ];
  const real = new Set<string | undefined>(Object.values(REAL_VENDOR_BASES));
  return configured.flatMap((base) => {
    if (base === undefined || real.has(base)) return [];
    try {
      return [new URL(base).origin];
    } catch {
      return [];
    }
  });
}
