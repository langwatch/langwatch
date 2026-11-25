// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceConfig } from "@langwatch/enterprise-governance-contract";

/** A keyless S3 source reads as the deployment only on a deployment known to be self-hosted. */
export function readsAwsAsDeployment({
  config,
}: {
  config: Pick<GovernanceConfig, "isSaas"> | undefined;
}): boolean {
  return config?.isSaas === false;
}
