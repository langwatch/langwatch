/** Opaque on purpose: nothing reads the plugin, it is only handed over. */
export interface BetterAuthPasskeyPlugin {
  readonly id: "passkey";
}

export declare function passkeyClient(): BetterAuthPasskeyPlugin;
