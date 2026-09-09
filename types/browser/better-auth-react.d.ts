/**
 * What the browser knows about `better-auth/react`.
 *
 * The real declaration reaches the server half of better-auth, and through it
 * a database adapter: importing `createAuthClient` loads 576 declaration files
 * into a browser program, 251 of them kysely — a SQL query builder no
 * first-party file names and no browser can run. The `paths` entries in
 * `apps/ui/tsconfig.json` and `modules/auth/web/tsconfig.json` point
 * the two browser programs here instead. Nothing about the RUNTIME changes:
 * vite and node both resolve the real package, which `paths` never touches.
 *
 * So this file is a contract, and it may only ever grow to match what the
 * three call sites use. `better-auth-surface.unit.test.ts` runs against the
 * real package and fails when a method named here stops existing.
 */

/** A refusal, as better-auth reports one to the browser. */
export interface BetterAuthError {
  message?: string;
  code?: string;
  status: number;
  statusText?: string;
}

/** Every call answers with data or a refusal, never by throwing on a 4xx. */
export interface BetterAuthResult<TData = unknown> {
  data?: TData;
  error?: BetterAuthError | null;
}

/** The per-call fetch hooks, of which only `onError` is read. */
export interface BetterAuthFetchOptions {
  onError?: (context: { response?: { headers?: Headers } }) => void;
}

/**
 * The passkey half. It exists on the client only when `passkeyClient()` is in
 * `plugins`, which both browser clients that use it pass — stating it
 * unconditionally is the simplification this file makes, and the one place a
 * caller could be told a method exists when the plugin is absent.
 */
export interface BetterAuthPasskeyApi {
  addPasskey: (input: {
    context?: string;
    name?: string;
    createSession?: boolean;
  }) => Promise<BetterAuthResult | undefined>;
  listUserPasskeys: () => Promise<BetterAuthResult>;
  deletePasskey: (input: { id: string }) => Promise<BetterAuthResult | undefined>;
  updatePasskey: (input: { id: string; name: string }) => Promise<BetterAuthResult | undefined>;
}

export interface BetterAuthSignInApi {
  email: (input: {
    email: string;
    password: string;
    callbackURL?: string;
    fetchOptions?: BetterAuthFetchOptions;
  }) => Promise<BetterAuthResult>;
  social: (input: {
    provider: string;
    callbackURL?: string;
    disableRedirect?: boolean;
  }) => Promise<BetterAuthResult<{ url?: string; redirect?: boolean }>>;
  passkey: (input?: { autoFill?: boolean }) => Promise<BetterAuthResult | undefined>;
}

export interface BetterAuthBrowserClient {
  $fetch: (path: string) => Promise<{ data?: unknown; error?: unknown }>;
  signIn: BetterAuthSignInApi;
  signOut: () => Promise<unknown>;
  getSession: () => Promise<BetterAuthResult>;
  requestPasswordReset: (input: {
    email: string;
    redirectTo?: string;
  }) => Promise<BetterAuthResult | undefined>;
  resetPassword: (input: {
    newPassword: string;
    token?: string;
  }) => Promise<BetterAuthResult | undefined>;
  passkey: BetterAuthPasskeyApi;
}

export declare function createAuthClient(options?: {
  plugins?: readonly unknown[];
  baseURL?: string;
  basePath?: string;
}): BetterAuthBrowserClient;
