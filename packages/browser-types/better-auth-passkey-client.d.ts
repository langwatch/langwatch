/**
 * What the browser knows about `@better-auth/passkey/client`.
 *
 * The plugin factory is only ever passed straight into `createAuthClient`'s
 * `plugins` array, and its real declaration pulls the same 251 kysely files
 * as `better-auth/react` on its own. The browser programs resolve it here
 * through `paths`; the runtime still loads the real package.
 */

/** Opaque on purpose: nothing reads the plugin, it is only handed over. */
export interface BetterAuthPasskeyPlugin {
  readonly id: "passkey";
}

export declare function passkeyClient(): BetterAuthPasskeyPlugin;
