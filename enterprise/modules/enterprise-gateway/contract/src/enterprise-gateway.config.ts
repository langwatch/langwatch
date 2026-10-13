// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  Config,
  type ConfigOf,
  gatewayAddressOf,
  gatewayLegacyUrl,
  gatewayPublicUrl,
  isSaas,
} from "@langwatch/config";

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
  return gatewayAddressOf({
    publicUrl: config?.gatewayPublicUrl,
    legacyUrl: config?.gatewayLegacyUrl,
    isSaas,
  });
}
