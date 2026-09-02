/**
 * What the API Keys settings screen and the CLI authorize screen ask of the
 * application they are mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton, the
 * session client or `fetch`: those are the imports and globals ADR-004 seals off
 * from a feature-web package, and reaching for any of them is also what would
 * make these screens untestable outside a running application. They ask this
 * port instead, and the frontend feature that owns it —
 * `apps/ui/src/features/api-key` — answers it by adapting the browser
 * capabilities the application resolves.
 *
 * THE ELEVENTH FAMILY TO DECLARE THIS SHAPE, after governance, gateway, the
 * personal workspace, automations, ops, agents, data governance, datasets,
 * model providers, RBAC and annotations. Every one of those recorded that a
 * repeat is the signal to promote it into one place, and every one left it, for
 * the same reason: promotion changes packages a page-family move does not own.
 * Recorded again in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHAT THIS FAMILY ASKS THAT NO OTHER DID is the CLI DEVICE FLOW. `/cli/auth`
 * talks to three REST endpoints the application serves — `/api/auth/cli/lookup`,
 * `/api/auth/cli/approve` and `/api/auth/cli/deny` — and the CLI in
 * `sdks/typescript` polls the other side of that exchange. A screen may not call
 * `fetch`, and the exchange is a transport concern rather than a screen one, so
 * the three calls are port methods and the adapter owns the wire. That split is
 * what lets the wire be pinned where it lives (`apps/ui/tests`) and the
 * SELECTION be pinned where it is decided (this package).
 */

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
  /**
   * The LEGACY project base key, as the API Keys table renders it.
   *
   * This is a credential, and it is on the port because the row exists: the
   * platform page read `project.apiKey` off the organization graph the shell
   * already holds, showed `sk-…` plus the last four characters, and offered a
   * copy action carrying the full value. Nothing here widens that — the value
   * was already in the browser before this family moved, and the only surface
   * that reveals it in full is the reader's own clipboard.
   */
  projectApiKey: string | undefined;
};

/**
 * The organization, teams and projects the reader can SEE.
 *
 * The scope FILTER at the top of the API Keys table offers every one of them,
 * and the scope chips on a key row resolve a scope id to the name it should
 * read as.
 *
 * Declared structurally rather than as `AvailableScopes` from
 * `@langwatch/authz-web`: the two are the same three fields, and naming that
 * package here would put a second `ui-screen-closure` finding on the family for
 * a shape the port can spell out.
 */
export type ApiKeyAvailableScopes = {
  organization: { id: string; name: string } | null;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; teamId?: string | null }>;
};

/**
 * The organization graph the CLI authorize screen walks.
 *
 * Wider than {@link ApiKeyAvailableScopes} because the project picker asks
 * questions the filter never does: which project is the CALLER'S OWN personal
 * workspace (`ownerUserId`), which team is a personal one, which project is the
 * hidden tenancy project (`kind`), and which slug the reader last worked in.
 * Narrowed to exactly those fields rather than restating
 * `FullyLoadedOrganization`, which is a server type built from Prisma rows and
 * has no business in a browser package.
 */
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

/**
 * Whether the session answer has arrived.
 *
 * `/cli/auth` needs the difference: a reader who is NOT signed in is bounced
 * through SSO with the device code preserved, and a reader whose session is
 * still arriving must not be, or every load of the page would round-trip through
 * sign-in before the answer landed.
 */
export type ApiKeySessionStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * The path parameters, query string and FRAGMENT a screen was opened with.
 *
 * The fragment is here because of one behaviour worth keeping: a trace's
 * `langwatch.api_key` attribute links to `/settings/api-keys#api-key-<id>`, and
 * the row it names does not exist until the keys query resolves — long after the
 * browser has given up on scrolling to it. The screen re-does that scroll once
 * the rows are in, and reading `window.location.hash` to do it would be a screen
 * naming a browser global.
 */
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

/**
 * A failure, as a screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type ApiKeyFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /**
   * A sentence for a refusal the SCREEN made rather than the server.
   *
   * The two form guards on the API Keys page — a restricted key with no scope,
   * and a personal key for somebody who holds no bindings at all — are decided
   * in the browser and have no code to look up. Without this they would degrade
   * to the generic "something went wrong on our side", which is both untrue and
   * unactionable. Ignored the moment the error carries a code the host knows.
   */
  description?: string;
  id?: string;
};

/**
 * A `platform/app` drawer these screens open by address rather than by mounting.
 *
 * `createProject` is registered in `platform/app/src/components/drawerRegistry.ts`
 * and opened by `DashboardLayout` as well, so this move may not delete it, and a
 * screen may not carry a copy of a registry — nor of `ProjectForm`, which is 301
 * lines of team selection and slug validation belonging to the organization
 * settings family.
 */
export type ApiKeyPlatformDrawer = "createProject";

/**
 * Which credential the CLI is asking for.
 *
 *  - `device_session`: user-scoped CLI session token written to
 *    `~/.langwatch/config.json`. Used by `langwatch claude/codex/etc`,
 *    `whoami`, governance commands.
 *  - `project_api_key`: project-scoped SDK API key written to `.env`. Used by
 *    `langwatch sync`, `langwatch eval`, `langwatch prompt`, and the SDK
 *    auto-instrumentation.
 */
export type CliCredentialType = "device_session" | "project_api_key";

/**
 * What `/api/auth/cli/lookup` answered.
 *
 * Four outcomes, because the endpoint has four: a pending code, a 410 for one
 * that expired, a 404 for one nothing recognises, and everything else. They are
 * separate cases rather than one nullable answer because the screen says
 * something different for each, and collapsing "expired" into "failed" would
 * lose the one sentence that tells the reader to run `langwatch login` again.
 */
export type CliDeviceCodeLookup =
  | {
      outcome: "pending";
      userCode: string;
      status: string;
      expiresAt: number;
      credentialType: CliCredentialType;
    }
  | { outcome: "expired" }
  | { outcome: "unknown" }
  | { outcome: "failed"; message: string };

/**
 * The selection an approval carries, in the screen's own vocabulary.
 *
 * The adapter turns this into the request body — `user_code`,
 * `organization_id`, `project_id` and the `key_selection` whose bindings are
 * `scope_type`/`scope_id` — because the snake-cased wire is the CLI's, not the
 * screen's. `permissions` is already narrowed to what the caller holds at every
 * selected scope; the mint refuses the whole approval rather than dropping one.
 */
export type CliDeviceApproval = {
  userCode: string;
  organizationId: string;
  projectId?: string;
  keySelection?: {
    bindings: Array<{ scopeType: string; scopeId: string }>;
    permissions: string[];
  };
};

/** What an approve or a deny came back as. */
export type CliDeviceActionResult = { outcome: "ok" } | { outcome: "failed"; message: string };

/** The one thing the screens are handed. */
export abstract class ApiKeyHostPort {
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

  /**
   * Writes something to the reader's clipboard and says so.
   *
   * The success notice is the SCREEN's, because only the screen knows what was
   * copied — a key, a snippet, a config path. The FAILURE line is the
   * application's: a clipboard write that is refused (Safari private mode, a
   * non-secure context) is not a failure of anything the screen did, and every
   * copy button in the product says the same thing about it. Answers whether
   * the write actually landed, so a button only shows its tick when it did.
   */
  abstract copyToClipboard(request: {
    text: string;
    succeeded: ApiKeySuccessNotice;
  }): Promise<boolean>;

  /**
   * First-touch acquisition source, recorded only when nothing claimed it yet.
   *
   * A browser opened by `langwatch login` carries no `utm_*` or `ref`
   * parameters, so the CLI stamps itself here and the round trip through
   * onboarding lands it in `signupData`. FIRST-TOUCH: a reader who originally
   * arrived through a campaign keeps their real source, which is why the port
   * says `IfAbsent` rather than `set`.
   */
  abstract recordLeadSourceIfAbsent(source: string): void;

  /**
   * Puts a `platform/app` drawer's address in the URL.
   *
   * `params` are the DRAWER'S OWN parameter names, unprefixed — the `drawer.`
   * vocabulary belongs to the host, which writes `?drawer.open=<drawer>` plus
   * one `drawer.<name>` per parameter and clears every stale `drawer.*` key,
   * exactly as `openDrawer` does. The model-provider family's shape.
   *
   * KNOWN GAP, shared with the agents, me, automations, model-provider,
   * annotations and gateway families: nothing mounts that registry above a
   * screen served from `apps/ui` until the chrome layout route exists, so the
   * address is right and the drawer does not open yet.
   */
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

const ApiKeyHostContext = createContext<ApiKeyHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const ApiKeyHostProvider = ApiKeyHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useApiKeyHost(): ApiKeyHostPort {
  const host = useContext(ApiKeyHostContext);
  if (!host) {
    throw new Error(
      "No API Key host is mounted above this screen; render it inside the api-key frontend feature.",
    );
  }
  return host;
}
