/**
 * A screen may not import `@langwatch/ui`, the router, a toast singleton,
 * the session client or Web Storage (ADR-004), so it asks this port
 * instead; `apps/ui/src/features/prompt` answers it.
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
   * Sent, not displayed, by two surfaces: the playground chat authenticates
   * its run with it, and the deploy dialog seeds the code snippets it
   * prints. The application already puts it in the browser for both.
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
 * The raw `error` travels, never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so writing copy here would
 * print the slug at the customer. `fallbackTitle` names the failed action.
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
 * Whether this deployment runs the playground chat, and what to say when
 * it does not. Copy travels with the answer rather than being written
 * here: it's resolved from an error code by the host's presentation registry.
 */
export type PromptPlaygroundChatAvailability =
  | { available: true }
  | { available: false; title: string; description: string };

/**
 * `traceV2Details` is registered in `drawerRegistry.ts` — a registry is
 * composition, so a screen only ever needs the address, never a copy of it.
 * Nothing mounts that registry above `apps/ui` yet, so it does not open yet.
 */
export type PromptPlatformDrawer = "traceV2Details";

/** The one thing the screen is handed. */
export abstract class PromptHostApi {
  /** The organization, team and project this page is about. */
  abstract scope(): PromptHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /**
   * The playground conversation labels one side with the person writing
   * it, because "User" names neither of the two parties being compared.
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
   * `platform/app` dedupes a refusal already rendered as a modal via a
   * `WeakSet` its interceptors write to. That cache doesn't wrap the
   * `apps/ui` build, so this always answers `false` here — a recorded gap.
   */
  abstract isReportedGlobally(error: unknown): boolean;

  /** Every project the reader may copy a prompt into. */
  abstract copyTargets(): readonly PromptCopyTarget[];

  /** Whether this deployment runs the playground chat the Conversation tab hosts. */
  abstract playgroundChat(): PromptPlaygroundChatAvailability;

  /**
   * Answered by the application with real Web Storage; a test hands an
   * in-memory double. Keyed by project, so the same capabilities serve
   * every project the reader visits in one session.
   */
  abstract tabCapabilities(): PromptTabsCapabilities;

  /**
   * `platform/app` opens this from a module-level zustand store the whole
   * application shares; a package may not reach it directly, and the
   * prompt limit is the one place this screen hits it.
   */
  abstract requestUpgrade(): void;

  /**
   * `params` are the DRAWER'S OWN names, unprefixed — the host writes
   * `?drawer.open=<drawer>` plus one `drawer.<name>` per parameter and
   * clears every stale `drawer.*` key, exactly as `openDrawer` does.
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
 * Missing means the screen was rendered outside the frontend feature that
 * owns it — a composition fault, not something a screen can degrade around.
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
