/**
 * What the Prompt Studio screen asks of the application it is mounted in. A
 * screen may not import `@langwatch/ui`, the router, a toast singleton, the
 * session client or Web Storage (ADR-004), so it asks this port instead; the
 * frontend feature that owns it — `apps/ui/src/features/prompt` — answers it.
 * `tabCapabilities` persists open prompt tabs per project in Web Storage.
 */

import { createContext, useContext } from "react";
import type { PromptTabsCapabilities } from "./browser-capabilities.ts";

/** The organization, team and project the address is about. */
export type PromptHostScope = {
  organizationId: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
  projectSlug: string | undefined;
  /**
   * The project's API key, which two surfaces send rather than display: the
   * playground chat authenticates its run with it, and the deploy dialog seeds
   * the code snippets it prints. The application already puts it in the browser
   * for both.
   */
  projectApiKey: string | undefined;
};

/** The path parameters and query string the screen was opened with. */
export type PromptRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type PromptSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type PromptFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** One project a prompt may be copied into. */
export type PromptCopyTarget = {
  id: string;
  name: string;
  slug: string;
  teamName?: string;
};

/**
 * Whether this deployment runs the playground chat, and what to say when it
 * does not — a deployment with no execution endpoint mounted used to render
 * the chat anyway, and a message posted into it 404'd with no explanation.
 * The words travel with the answer rather than being written here: copy is
 * resolved from an error code by the host's presentation registry.
 */
export type PromptPlaygroundChatAvailability =
  | { available: true }
  | { available: false; title: string; description: string };

/**
 * A `platform/app` drawer this screen opens by address rather than by mounting.
 *
 * `traceV2Details` is registered in `platform/app/src/components/drawerRegistry.ts`,
 * so this move may not delete or copy it — a registry is composition, and a screen
 * only ever needed the address. Nothing mounts that registry above a screen served
 * from `apps/ui` yet, so the address is right and the drawer does not open yet.
 */
export type PromptPlatformDrawer = "traceV2Details";

/** The one thing the screen is handed. */
export abstract class PromptHostApi {
  /** The organization, team and project this page is about. */
  abstract scope(): PromptHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /**
   * The reader's own profile name, or nothing.
   *
   * The playground conversation labels one side with the person writing it,
   * because "User" names neither of the two parties a reader is comparing.
   */
  abstract currentUserName(): string | null | undefined;

  abstract route(): PromptRouteReading;

  /** The whole next query string, so the screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: PromptSuccessNotice): void;

  abstract failed(failure: PromptFailureNotice): void;

  /**
   * Whether the application has already shown this failure to the reader.
   *
   * `platform/app` dedupes a refusal one of its global mutation interceptors
   * already rendered as a modal, via a `WeakSet` those interceptors write to.
   * That cache does not wrap the client `apps/ui` build, so nothing reaching
   * this screen has been through them — answered `false` here, a recorded gap.
   */
  abstract isReportedGlobally(error: unknown): boolean;

  /** Every project the reader may copy a prompt into. */
  abstract copyTargets(): readonly PromptCopyTarget[];

  /** Whether this deployment runs the playground chat the Conversation tab hosts. */
  abstract playgroundChat(): PromptPlaygroundChatAvailability;

  /**
   * Where the persisted prompt tabs are kept, and where the store logs.
   *
   * Answered by the application with real Web Storage; a test hands an
   * in-memory double. The store is keyed by project, so the same capabilities
   * serve every project the reader visits in one session.
   */
  abstract tabCapabilities(): PromptTabsCapabilities;

  /**
   * Asks the application to offer an upgrade.
   *
   * `platform/app` opened a modal from a module-level zustand store that the
   * whole application shares; a package may not reach it, and the prompt limit
   * is the one place this screen hits it.
   */
  abstract requestUpgrade(): void;

  /**
   * Puts a `platform/app` drawer's address in the URL.
   *
   * `params` are the DRAWER'S OWN parameter names, unprefixed — the `drawer.`
   * vocabulary belongs to the host, which writes `?drawer.open=<drawer>` plus
   * one `drawer.<name>` per parameter and clears every stale `drawer.*` key,
   * exactly as `openDrawer` does. The shape the model-config family settled.
   */
  abstract openPlatformDrawer(request: {
    drawer: PromptPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void;
}

const PromptHostContext = createContext<PromptHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const PromptHostProvider = PromptHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function usePromptHost(): PromptHostApi {
  const host = useContext(PromptHostContext);
  if (!host) {
    throw new Error(
      "No Prompt host is mounted above this screen; render it inside the prompt frontend feature.",
    );
  }
  return host;
}
