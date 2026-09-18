/**
 * Where the reader is standing, as a capability of its own: scope answers a
 * different question from "who is here" and settles on its own schedule.
 */

import { UiCapabilityUnavailableError, useOptionalUiCapabilities } from "./capabilities.ts";
import type { UiScopeHost } from "./use-organization-team-project.ts";

/** The organization and project the current page is about. */
export type UiActiveScope = {
  organizationId: string | null;
  projectId: string | null;
};

/** Where the reader is standing, as every screen and every feature reads it. */
export abstract class UiScope {
  abstract activeScope(): UiActiveScope;

  /**
   * The scope as every feature's shared `useOrganizationTeamProject` reads it.
   * Absent is a reading, never a throw: a cross-feature component stays alive
   * on a route whose own host never mounted.
   */
  scopeHost(): UiScopeHost | undefined {
    return void 0;
  }
}

class UnavailableUiScope extends UiScope {
  activeScope(): never {
    throw new UiCapabilityUnavailableError("scope");
  }
}

/** The default for a composition that named no scope source. Refuses by name. */
export const UNAVAILABLE_UI_SCOPE: UiScope = new UnavailableUiScope();

/**
 * Where this screen is standing. Mounted outside a shell it reads the refusing
 * port, which names the missing capability rather than inventing a scope.
 */
export function useUiScope(): UiScope {
  return useOptionalUiCapabilities()?.scope ?? UNAVAILABLE_UI_SCOPE;
}
