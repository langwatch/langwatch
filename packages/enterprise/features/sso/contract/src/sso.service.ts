import type { SsoConfiguration } from "./sso.contract";

/** Portable SSO capability exposed to Enterprise composition roots. */
export abstract class SsoService {
  abstract platformAllowed(): Promise<boolean>;
  abstract providerIsMounted(): boolean;
  abstract resolveProvider(): Promise<string>;
}

export { SsoService as SsoGate };

export type SsoServiceConfiguration = SsoConfiguration;
