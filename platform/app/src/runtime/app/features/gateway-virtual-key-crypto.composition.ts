import { VirtualKeyCryptoAdapter } from "@langwatch/gateway-server";

export interface VirtualKeyCryptoProcessConfig {
  readonly virtualKeyPepper?: string;
}

/** Creates the one virtual-key crypto capability for a composed process. */
export function createProcessVirtualKeyCrypto(config: VirtualKeyCryptoProcessConfig) {
  return VirtualKeyCryptoAdapter.create({ pepper: config.virtualKeyPepper });
}
