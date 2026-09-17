/**
 * What the browser knows about `better-auth/react`. The real declaration
 * pulls in the server half (576 files, 251 kysely) via `createAuthClient`,
 * so both browser tsconfigs' `paths` point here — grows only to match usage.
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
