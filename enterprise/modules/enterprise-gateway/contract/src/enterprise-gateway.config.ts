// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Config,
  type ConfigOf,
  gatewayLegacyUrl,
  gatewayPublicUrl,
  isSaas,
} from "@langwatch/config";
import { resolveGatewayBaseUrl } from "@langwatch/config/public-app-config/projection";

/** Where issued personal keys send traffic. */
export const enterpriseGatewayConfig = Config.define(() => ({
  gatewayPublicUrl,
  gatewayLegacyUrl,
  /** The hosted product, which picks the default gateway address. */
  isSaas,
}));
export type EnterpriseGatewayConfig = ConfigOf<typeof enterpriseGatewayConfig>;

/** A personal key's gateway address: public URL, legacy URL, then the SaaS or local default. */
export function enterpriseGatewayBaseUrl({
  config,
  isSaas,
}: {
  config: EnterpriseGatewayConfig | undefined;
  isSaas: boolean;
}): string {
  return resolveGatewayBaseUrl({
    LW_GATEWAY_PUBLIC_URL: config?.gatewayPublicUrl,
    LW_GATEWAY_BASE_URL: config?.gatewayLegacyUrl,
    IS_SAAS: isSaas,
  });
}
