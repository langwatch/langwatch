/**
 * What the simulations, scenario-library and Agent Testing screens ask of the
 * application they are mounted in.
 *
 * ONE PORT FOR THE WHOLE FAMILY — the shape governance, gateway, me,
 * automations, ops, agents, datasets, model-config, RBAC, annotations,
 * organization, analytics, evaluators, monitors, workflows, the auth front door
 * and traces each wrote before it. Everything these screens used to read off
 * `useOrganizationTeamProject`, `useRouter`, `useRequiredSession` and the
 * toaster arrives through these methods, which is what let twenty-two thousand
 * lines move with their `api.scenarios.x.useQuery` call sites unchanged.
 *
 * `setQuery` MERGES, for the reason the trace family recorded: the suite rail,
 * the batch highlight, the run drawer and the tab follower each write their own
 * keys from different components in the same tick, and a replacing write would
 * drop whichever half did not do the writing. Removing a key is `undefined`.
 *
 * `route()` carries a `pathname` because the simulations catch-all decides
 * which of five addresses it is serving from the path, and `params.path` is the
 * splat the route table hands it.
 */

import { createContext, useContext } from "react";

/** The project every scenario read is scoped to. */
export type ScenarioHostProject = {
  id: string;
  slug: string;
  name: string;
  /** Whether anything has ever been ingested — the empty states lead on it. */
  firstMessage?: boolean;
  /** The ingestion key the "connect your agent" pane prints. */
  apiKey?: string;
};

/** The team the project belongs to, and the two facts that decide a personal workspace. */
export type ScenarioHostTeam = {
  id: string;
  name?: string;
  slug?: string;
  isPersonal?: boolean;
  ownerUserId?: string | null;
  members?: { userId: string }[];
};

export type ScenarioHostOrganization = {
  id: string;
  name?: string;
  slug?: string;
};

export type ScenarioHostOrganizationRole = string | undefined;

export type ScenarioHostUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/** The address, as a screen reads it. */
export type ScenarioRouteReading = {
  /** Path parameters, the splat included. */
  params: Readonly<Record<string, string | string[] | undefined>>;
  /** The query string, flat. */
  query: Readonly<Record<string, string | undefined>>;
  /** The path alone. */
  pathname: string;
};

export type ScenarioSuccessNotice = { title: string; description?: string };

/**
 * The one way out a failure offers.
 *
 * `run` rather than `onClick`: a port says what happens, and the application's
 * toaster is what turns it into a click. Rare by design — a button that only
 * re-runs what just failed is noise — but the four scenario failures that have
 * a real fix (open the run plan with nothing runnable in it, configure the
 * model provider a run needs) would otherwise have to choose between the
 * registry's words and the button that acts on them.
 */
export type ScenarioFailureAction = {
  label: string;
  run: () => void;
};

export type ScenarioFailureNotice = {
  /** The raw failure. The application resolves the words from its own registry. */
  error: unknown;
  /** What the reader was trying to do, for a code the registry does not list. */
  fallbackTitle: string;
  /** A sentence the caller already had, where it knows better than the registry. */
  description?: string;
  /** The single fix this failure offers, rendered as a button on the notice. */
  action?: ScenarioFailureAction;
  /** A dedupe id, so a retried failure replaces its own notice rather than stacking. */
  id?: string;
};

/**
 * The questions this family asks its host.
 *
 * An abstract class rather than an interface so the package can define it
 * without importing anything of ours, and so an adapter's answers are checked
 * against it.
 */
export abstract class ScenarioHostPort {
  abstract project(): ScenarioHostProject | undefined;

  abstract organization(): ScenarioHostOrganization | undefined;

  abstract team(): ScenarioHostTeam | undefined;

  abstract organizationRole(): ScenarioHostOrganizationRole;

  abstract currentUser(): ScenarioHostUser | undefined;

  abstract hasPermission(permission: string): boolean;

  /** Whether the scope answer is still arriving. */
  abstract isLoading(): boolean;

  abstract route(): ScenarioRouteReading;

  /** MERGES into the query, so a screen can set one key without owning the rest. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string, options?: { replace?: boolean }): void;

  abstract succeeded(notice: ScenarioSuccessNotice): void;

  abstract failed(failure: ScenarioFailureNotice): void;
}

const ScenarioHostContext = createContext<ScenarioHostPort | undefined>(void 0);

export const ScenarioHostProvider = ScenarioHostContext.Provider;

/** The host the composing application mounted above this screen. */
export function useScenarioHost(): ScenarioHostPort {
  const host = useContext(ScenarioHostContext);
  if (!host) {
    throw new Error("The scenario screens must be mounted inside a ScenarioHostProvider.");
  }
  return host;
}

/** The host, where a surface may legitimately render without one. */
export function useOptionalScenarioHost(): ScenarioHostPort | undefined {
  return useContext(ScenarioHostContext);
}
