/**
 * What the Prompt Studio screen asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton, the
 * session client or Web Storage: those are the imports ADR-004 seals off from a
 * feature-web package, and reaching for any of them is also what would make the
 * screen untestable outside a running application. It asks this port instead,
 * and the frontend feature that owns it — `apps/ui/src/features/prompt` —
 * answers it by adapting the browser capabilities the application resolves.
 *
 * THE TENTH FAMILY TO DECLARE THIS SHAPE, after governance, gateway, the
 * personal workspace, automations, ops, agents, data governance, datasets and
 * model configuration. Every one of those recorded that a repeat is the signal
 * to promote it into one place, and every one left it, for the same reason:
 * promotion changes packages a page-family move does not own. Recorded again in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHAT THIS FAMILY ASKS THAT THE OTHERS DID NOT is `tabCapabilities`. The open
 * prompt tabs are persisted per project in Web Storage, one key per tab, and
 * the store that owns them was already written to take its storage and its
 * logger as arguments (`model/browser-capabilities.ts`) — `platform/app` bound
 * them to `window.localStorage` in an app adapter. That adapter is what the
 * host answers now, so the package never names a browser global and the screen
 * closure stays clean.
 */

import { createContext, useContext } from "react";
import type { PromptTabsCapabilities } from "./browser-capabilities";

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
 * does not.
 *
 * The chat is not a screen this package can decide about on its own: it talks
 * to a chat runtime the SERVER has to mount, and whether one is mounted is a
 * property of the process the screen was served from. `apps/api` declares that
 * family absent at boot in so many words — "API process serves no
 * /api/copilotkit" — so on this deployment the chat had nowhere to post, and
 * rendered anyway. A reader typed a message and got a 404 with no explanation.
 *
 * The words travel with the answer rather than being written here, because the
 * copy a customer reads is resolved from an error code by the host's
 * presentation registry, and a package that composed its own sentence would be
 * the one place in the product where that is not true.
 */
export type PromptPlaygroundChatAvailability =
  | { available: true }
  | { available: false; title: string; description: string };

/**
 * A `platform/app` drawer this screen opens by address rather than by mounting.
 *
 * `traceV2Details` is registered in `platform/app/src/components/drawerRegistry.ts`
 * and opened by most of the product, so this move may not delete it and may not
 * copy it — a registry is composition, and a screen only ever needed the
 * address. Same recorded gap the me, automations, agents and model-config
 * families carry: nothing mounts that registry above a screen served from
 * `apps/ui` until the chrome layout route exists, so the address is right and
 * the drawer does not open yet.
 */
export type PromptPlatformDrawer = "traceV2Details";

/** The one thing the screen is handed. */
export abstract class PromptHostPort {
  /** The organization, team and project this page is about. */
  abstract scope(): PromptHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

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
   * `platform/app` deduped a refusal one of its four global mutation
   * interceptors had already rendered as a modal — the prompt limit, the
   * lite-member restriction — so a reader was not told the same thing twice,
   * and the prompt actions asked before toasting. A RECORDED GAP, answered
   * `false` in this application: that answer is a `WeakSet` those interceptors
   * write to, and the cache they live on does not wrap the client `apps/ui`
   * builds. Nothing reaching this screen has been through them, so nothing has
   * been reported twice; the screen's own notice is the only one. Same shape
   * the datasets and model-config families recorded, third use.
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

const PromptHostContext = createContext<PromptHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const PromptHostProvider = PromptHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function usePromptHost(): PromptHostPort {
  const host = useContext(PromptHostContext);
  if (!host) {
    throw new Error(
      "No Prompt host is mounted above this screen; render it inside the prompt frontend feature.",
    );
  }
  return host;
}
