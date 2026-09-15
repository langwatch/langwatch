// Host port for the automations screen; defines browser capabilities the screen needs (React
// context only, no UI/router/toast imports); supports tri-state feature flag for webhook channel.

import type { DatasetColumns } from "@langwatch/dataset-contract";
import { createContext, useContext } from "react";

/** The organization, team and project the current page is about. */
export type AutomationScope = {
  organizationId: string | null;
  teamId: string | null;
  projectId: string | null;
};

/** The organization the reader is standing in. */
export type AutomationOrganization = {
  id: string;
  name: string;
  slug: string;
};

export type AutomationTeam = {
  id: string;
  name: string;
  slug: string;
};

/** The project every automation in this family belongs to. */
export type AutomationProject = {
  id: string;
  name: string;
  slug: string;
};

/** The path parameters and query string the screen was opened with. */
export type AutomationRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type AutomationSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: since the
 * wire message of a handled error is its code slug, a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type AutomationFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /** Overrides the title outright, for a code the screen can name better. */
  title?: string;
  id?: string;
};

// Methods for the automations screen; drawers named by the application to prevent addressing
// unregistered overlays.
export type AutomationDrawer = "automation" | "viewAutomation";

/** A dataset the reader created without leaving the automation they were
 *  authoring. `columnTypes` is the dataset's column list, which the automation
 *  turns into its trace mapping. */
export type AutomationDatasetCreation = {
  datasetId: string;
  columnTypes: DatasetColumns;
};

export abstract class AutomationHost {
  /** The organization, team and project this page is about. */
  abstract scope(): AutomationScope;

  abstract organization(): AutomationOrganization | undefined;

  abstract team(): AutomationTeam | undefined;

  /** The project the address is about. Automations are project-scoped. */
  abstract project(): AutomationProject | undefined;

  /** Fails closed: an answer that has not arrived reads as no. */
  abstract hasPermission(permission: string): boolean;

  /** Fails closed the same way. */
  abstract isFeatureEnabled(flag: string): boolean;

  /**
   * The same flag, undecided included.
   *
   * `undefined` means the answer has not arrived. Only one surface needs the
   * difference — a `SEND_WEBHOOK` prefill must wait rather than be dropped —
   * and everything else reads `isFeatureEnabled`.
   */
  abstract featureFlag(flag: string): boolean | undefined;

  abstract route(): AutomationRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  /** Put a registered drawer's address in the URL; screen names drawer, host writes
   *  ?drawer.open and per-drawer parameters. */
  abstract openDrawer(request: {
    drawer: AutomationDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void;

  /** Hands over to dataset drawer and returns with created dataset; reports dataset via
   *  handover callback and navigates back rather than closing the stack. */
  abstract createDataset(handover: {
    created: (dataset: AutomationDatasetCreation) => void;
    returned: () => void;
  }): void;

  /**
   * The application's own address, for the links a rendered preview prints.
   *
   * `platform/app` read `window.location.origin` inside the drawer. A screen
   * may read the document it is rendered in, but the example URLs a preview
   * prints are a property of the deployment rather than of the browser tab, so
   * they come from the host and a test can state them.
   */
  abstract appBaseUrl(): string;

  abstract succeeded(notice: AutomationSuccessNotice): void;

  abstract failed(failure: AutomationFailureNotice): void;

  /** One line of copy for a failure, for the surfaces too tight for a toast. */
  abstract describeFailure(failure: AutomationFailureNotice): string;
}

const AutomationHostContext = createContext<AutomationHost | undefined>(void 0);

/** Publishes the host to every automations screen and drawer below it. */
export const AutomationHostProvider = AutomationHostContext.Provider;

/**
 * The application this screen is running in.
 *
 * Missing means the screen was mounted outside its frontend feature, which is a
 * composition fault rather than something the screen can degrade around.
 */
export function useAutomationHost(): AutomationHost {
  const host = useContext(AutomationHostContext);
  if (!host) {
    throw new Error(
      "No automation host is mounted above this screen; render it inside the automations frontend feature.",
    );
  }
  return host;
}
