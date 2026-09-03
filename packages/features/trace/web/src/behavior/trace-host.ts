/**
 * What the trace screens ask of the application they are mounted in.
 *
 * ONE PORT FOR THE WHOLE FAMILY — the twentieth of the shape governance,
 * gateway, me, automations, ops, agents, datasets, model-config, RBAC,
 * annotations, organization, analytics, evaluators, monitors, workflows and
 * the auth front door each wrote before it. Everything the explorer used to
 * read off `useOrganizationTeamProject`, `useRouter`, `useDrawer`,
 * `useRequiredSession`, `usePublicEnv` and the toaster arrives through these
 * methods, which is what lets a hundred thousand lines of trace explorer move
 * with their `api.tracesV2.x.useQuery` call sites unchanged.
 *
 * `setQuery` MERGES rather than replacing. The explorer writes one key at a
 * time — a drawer address, a span selection, a lens — while the filter rail,
 * the time range and the saved view all keep their own keys in the same query
 * string, and a replacing write would drop whichever half did not do the
 * writing. Removing a key is `undefined`, which merge honours.
 *
 * `route()` carries a `pathname` because two readings need it: the shared
 * trace page decides it is public from the address, and the explorer's own
 * `?span=` clearing has to know it is still on the traces page.
 */

import { createContext, useContext } from "react";

/** The project every trace read is scoped to. */
export type TraceHostProject = {
  id: string;
  slug: string;
  name: string;
  /** Whether anything has ever been ingested — the empty state leads on it. */
  firstMessage?: boolean;
  /** The ingestion key the Integrate pane prints. */
  apiKey?: string;
  /**
   * Whether live cursors and presence dots are on for this project.
   *
   * A tri-state on purpose: `undefined` is "not answered yet" and the surfaces
   * read it as ENABLED, so a first paint never flashes the feature off.
   */
  presenceEnabled?: boolean;
};

/**
 * The team the project belongs to, and the two facts that decide a personal
 * workspace.
 *
 * `isPersonal` plus `ownerUserId` is how every surface in the product asks "is
 * this the reader's own scratch project", and `members` is what the Langy gate
 * checks before offering an assistant that would 403.
 */
export type TraceHostTeam = {
  id: string;
  name?: string;
  slug?: string;
  isPersonal?: boolean;
  ownerUserId?: string | null;
  members?: { userId: string }[];
};

/** The organization the project sits in, for reads scoped above a project. */
export type TraceHostOrganization = {
  id: string;
  name?: string;
  slug?: string;
  /** The organization-wide kill switch for presence. Tri-state, as above. */
  presenceEnabled?: boolean;
};

/** The reader's standing in the organization, for the gates that read it. */
export type TraceHostOrganizationRole = "ADMIN" | "MEMBER" | "EXTERNAL" | undefined;

/** The reader, as an annotation or a presence cursor knows them. */
export type TraceHostUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/** The path parameters, the pathname and the query string a screen was opened with. */
export type TraceRouteReading = {
  /** The `:id` style segments the matched route captured. */
  params: Readonly<Record<string, string | undefined>>;
  /** The query string, single-valued — the last write of a repeated key wins. */
  query: Readonly<Record<string, string | undefined>>;
  /** The address the reader is on, route-pattern shaped (`/[project]/traces`). */
  pathname: string;
};

/** A short confirmation of something the reader just did. */
export type TraceSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as a screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the presentation
 * registry, and a screen that wrote its own would print the code slug instead
 * (#5984). `fallbackTitle` names the action that failed, so an unrecognised
 * code still says what the reader was doing.
 */
export type TraceFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /**
   * A sentence for a refusal the SCREEN can say more about than the registry.
   *
   * Ignored the moment the error carries a code the composition has copy for,
   * so it can never talk over registered copy. It is the channel for the
   * failures that have no code at all — a guard decided in the browser — and
   * for the ones whose registered copy is generic where the screen holds the
   * server's own numbers.
   */
  description?: string;
  id?: string;
};

export abstract class TraceHostPort {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): TraceHostProject | undefined;

  /** The organization the project sits in. */
  abstract organization(): TraceHostOrganization | undefined;

  /** The team the project belongs to. */
  abstract team(): TraceHostTeam | undefined;

  /** What the reader is in the organization. */
  abstract organizationRole(): TraceHostOrganizationRole;

  /** The signed-in reader, or undefined on the shared-trace page. */
  abstract currentUser(): TraceHostUser | undefined;

  abstract hasPermission(permission: string): boolean;

  /** Whether the scope answer is still arriving. */
  abstract isLoading(): boolean;

  abstract route(): TraceRouteReading;

  /** MERGES into the query, so a screen can set one key without owning the rest. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /** Sends the reader somewhere else in the application. */
  abstract navigate(to: string, options?: { replace?: boolean }): void;

  abstract succeeded(notice: TraceSuccessNotice): void;

  abstract failed(failure: TraceFailureNotice): void;
}

const TraceHostContext = createContext<TraceHostPort | undefined>(void 0);

export const TraceHostProvider = TraceHostContext.Provider;

/** The host the composing application mounted above this screen. */
export function useTraceHost(): TraceHostPort {
  const host = useContext(TraceHostContext);
  if (!host) {
    throw new Error("The trace screens must be mounted inside a TraceHostProvider.");
  }
  return host;
}

/** The host, where a surface may legitimately render without one (the shared page). */
export function useOptionalTraceHost(): TraceHostPort | undefined {
  return useContext(TraceHostContext);
}
