// API Keys and CLI authorize port. Screens can't reach ui, router, fetch, or session client;
// ask this instead. Unique: CLI device flow (three REST endpoints: lookup, approve, deny).

import { createContext, useContext } from "react";

/** The organization, team and project the addresses are about. */
export type ApiKeyHostScope = {
  organizationId: string | undefined;
  organizationName: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
  projectName: string | undefined;
  /** The slug of the project the reader last worked in, for the CLI picker's default. */
  projectSlug: string | undefined;
  /** LEGACY project base key. Credential: was already in browser before this family moved. */
  projectApiKey: string | undefined;
};

// Visible scopes: filter options and chip names. Declared structurally not via authz-web to avoid
// ui-screen-closure finding.
export type ApiKeyAvailableScopes = {
  organization: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId?: string | null }[];
};

// CLI authorize organization graph: wider than visible scopes (adds ownerUserId, kind, slug),
// narrowed from FullyLoadedOrganization (server-only Prisma type).
export type ApiKeyOrganizationProject = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean | null;
  ownerUserId?: string | null;
  kind?: string | null;
};

export type ApiKeyOrganizationTeam = {
  id: string;
  name: string;
  isPersonal?: boolean | null;
  projects?: ApiKeyOrganizationProject[] | null;
};

export type ApiKeyOrganization = {
  id: string;
  name: string;
  teams?: ApiKeyOrganizationTeam[] | null;
};

/** Who is signed in, as these screens need to know them. */
export type ApiKeyActor = { id: string } | null;

// Session status: /cli/auth needs the difference to avoid SSO bounce on loading.
export type ApiKeySessionStatus = "loading" | "authenticated" | "unauthenticated";

// Route params, query, fragment. Fragment kept: screen re-scrolls to api-key-<id> after keys
// query resolves, avoiding window.location.hash.
export type ApiKeyRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  /** The `#...` part of the address, without the hash. Empty when there is none. */
  fragment: string;
};

/** A short confirmation of something the reader just did. */
export type ApiKeySuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

// Failure: raw error + fallbackTitle. Wire message is code slug, never screen-composed copy.
export type ApiKeyFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  // Screen-made refusal copy (e.g., restricted key with no scope). Ignored if error has code.
  description?: string;
  id?: string;
};

// Platform drawer opened by address (createProject): not deleted because DashboardLayout uses it.
export type ApiKeyPlatformDrawer = "createProject";

// CLI credential type: device_session (user-scoped, ~/.langwatch/config.json) or project_api_key
// (SDK key, .env).
export type CliCredentialType = "device_session" | "project_api_key";

// Device code lookup result: four cases (pending, expired, unknown, failed) not one nullable;
// screen needs different messages for each.
export type CliDeviceCodeLookup =
  | {
      outcome: "pending";
      userCode: string;
      status: string;
      expiresAt: number;
      credentialType: CliCredentialType;
      /** Whether the CLI asked for team management (`langwatch login --manage-teams`). */
      teamManagement: boolean;
    }
  | { outcome: "expired" }
  | { outcome: "unknown" }
  | { outcome: "failed"; message: string };

// Approval selection in screen vocabulary. Adapter converts to snake_case wire (user_code,
// organization_id, etc.). Permissions already narrowed to caller's holdings.
export type CliDeviceApproval = {
  userCode: string;
  organizationId: string;
  projectId?: string;
  keySelection?: {
    bindings: { scopeType: string; scopeId: string }[];
    permissions: string[];
  };
};

/** What an approve or a deny came back as. */
export type CliDeviceActionResult = { outcome: "ok" } | { outcome: "failed"; message: string };

/** The one thing the screens are handed. */
export abstract class ApiKeyHostApi {
  /** The organization, team and project these pages are about. */
  abstract scope(): ApiKeyHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** Every scope the reader can see: the filter's options and the chips' names. */
  abstract availableScopes(): ApiKeyAvailableScopes;

  /** The organization graph the CLI project picker walks, or undefined while it loads. */
  abstract organizations(): ApiKeyOrganization[] | undefined;

  /** Who is signed in. */
  abstract currentUser(): ApiKeyActor;

  /** Whether the session answer has arrived, and what it said. */
  abstract sessionStatus(): ApiKeySessionStatus;

  /** Where the API a minted key will be used against lives, for the snippets. */
  abstract apiEndpoint(): string;

  abstract route(): ApiKeyRouteReading;

  /** The whole next query string, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /** Moves the address bar, replacing the current entry. */
  abstract replace(to: string): void;

  /** Moves the address bar, keeping the current entry in history. */
  abstract navigate(to: string): void;

  abstract succeeded(notice: ApiKeySuccessNotice): void;

  abstract failed(failure: ApiKeyFailureNotice): void;

  // Clipboard write + notice. Success notice is screen's (knows what copied); failure is app's
  // (clipboard refused). Returns true only if write landed.
  abstract copyToClipboard(request: {
    text: string;
    succeeded: ApiKeySuccessNotice;
  }): Promise<boolean>;

  // Lead source: CLI stamps itself (langwatch login carries no utm_* or ref). First-touch keeps
  // campaign source.
  abstract recordLeadSourceIfAbsent(source: string): void;

  // Platform drawer URL: params are drawer's own names (unprefixed). Host writes ?drawer.open +
  // drawer.<name>. KNOWN GAP: registry unmounted until chrome layout route exists.
  abstract openPlatformDrawer(request: {
    drawer: ApiKeyPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void;

  /** Asks the application whether a device code is still pending. */
  abstract lookupDeviceCode(userCode: string): Promise<CliDeviceCodeLookup>;

  /** Approves a device code with the reviewed selection. */
  abstract approveDeviceCode(approval: CliDeviceApproval): Promise<CliDeviceActionResult>;

  /** Rejects a device code. */
  abstract denyDeviceCode(userCode: string): Promise<CliDeviceActionResult>;
}

const ApiKeyHostContext = createContext<ApiKeyHostApi | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const ApiKeyHostProvider = ApiKeyHostContext.Provider;

/**
 * The host these screens are mounted in. Missing means a screen rendered
 * outside the frontend feature that owns it — a composition fault, not
 * something a screen can degrade around.
 */
export function useApiKeyHost(): ApiKeyHostApi {
  const host = useContext(ApiKeyHostContext);
  if (!host) {
    throw new Error(
      "No API Key host is mounted above this screen; render it inside the api-key frontend feature.",
    );
  }
  return host;
}

/** The `?scope=` parameter this page's filter is written to. */
export const API_KEY_SCOPE_QUERY_KEY = "scope";

/** The grant the legacy project key's rotation control is behind. */
export const PROJECT_KEY_ROTATE_PERMISSION = "project:manage";

/** The acquisition source a browser opened by `langwatch login` stamps. */
export const CLI_LEAD_SOURCE = "cli";
