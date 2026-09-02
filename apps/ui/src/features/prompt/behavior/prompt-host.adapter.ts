/**
 * The Prompt package's host port, answered from this application.
 *
 * `@langwatch/prompt-web` declares what Prompt Studio needs — the project, the
 * reader's grants, the address, the two notices, where a prompt may be copied
 * to, the storage its open tabs are persisted in, the upgrade prompt, and the
 * one `platform/app` drawer it addresses rather than mounts — as one abstract
 * class it can define without importing anything of ours. This is the other
 * half: a plain adapter over the capabilities the application shell resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * `isReportedGlobally` IS A RECORDED GAP RATHER THAN A CARRIED BEHAVIOUR, and
 * the honest answer here is `false`. `platform/app` dedupes a refusal that one
 * of its four global interceptors already rendered as a modal — the plan limit,
 * the lite-member restriction — and the prompt row actions asked before
 * toasting so a reader was not told the same thing twice. That answer is a
 * `WeakSet` those interceptors write to, and the interceptors live on
 * `platform/app`'s own MutationCache (`utils/api.tsx`), which does NOT wrap the
 * client `apps/ui` builds. Nothing reaching this screen has been through them,
 * so nothing has been reported twice; the screen's own notice is the only one.
 * The datasets family's shape, third use.
 */

import type {
  PromptCopyTarget,
  PromptFailureNotice,
  PromptHostScope,
  PromptRouteReading,
  PromptSuccessNotice,
} from "@langwatch/prompt-web/screens/prompt-studio";
import { PromptHostPort } from "@langwatch/prompt-web/screens/prompt-studio";

/** The grant `platform/app`'s page carried, unchanged. */
export const PROMPT_PAGE_PERMISSION = "prompts:view";

/** Everything the tab store needs from the browser, resolved by this shell. */
export type PromptTabCapabilities = {
  storage: {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  logger: {
    info(message: string): void;
    info(fields: Record<string, unknown>, message: string): void;
    warn(message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
    error(message: string): void;
    error(fields: Record<string, unknown>, message: string): void;
  };
};

export type PromptHostReadings = {
  scope: PromptHostScope;
  hasPermission: (permission: string) => boolean;
  copyTargets: readonly PromptCopyTarget[];
  route: PromptRouteReading;
  tabCapabilities: PromptTabCapabilities;
};

export type PromptHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: PromptSuccessNotice) => void;
  failed: (failure: PromptFailureNotice) => void;
  requestUpgrade: () => void;
};

export class UiPromptHost extends PromptHostPort {
  static create(readings: PromptHostReadings, actions: PromptHostActions): UiPromptHost {
    return new UiPromptHost(readings, actions);
  }

  private constructor(
    private readonly readings: PromptHostReadings,
    private readonly actions: PromptHostActions,
  ) {
    super();
  }

  scope(): PromptHostScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  route(): PromptRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  succeeded(notice: PromptSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: PromptFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * Whether the application has already told the reader about this failure.
   *
   * Always false in this composition — see the note at the top of the file. It
   * stays on the port rather than being dropped from it, because the screen's
   * question is the right one and it is this side of the seam that has no
   * answer yet.
   */
  isReportedGlobally(_error: unknown): boolean {
    return false;
  }

  copyTargets(): readonly PromptCopyTarget[] {
    return this.readings.copyTargets;
  }

  tabCapabilities(): PromptTabCapabilities {
    return this.readings.tabCapabilities;
  }

  requestUpgrade(): void {
    this.actions.requestUpgrade();
  }

  /**
   * Puts the trace drawer's address in the URL.
   *
   * `traceV2Details` is registered in `platform/app` and opened by most of the
   * product, so this move may neither delete nor copy it. The `drawer.`
   * vocabulary is written HERE rather than by the screen — the model-config
   * family's shape — including the clearing of every stale `drawer.*` key,
   * exactly as `openDrawer` does.
   *
   * KNOWN GAP: nothing mounts that registry above a screen served from
   * `apps/ui` until the chrome layout route exists, so the address is right and
   * the drawer does not open yet.
   */
  openPlatformDrawer(request: {
    drawer: "traceV2Details";
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    const cleared: Record<string, string | undefined> = {};
    for (const key of Object.keys(this.readings.route.query)) {
      if (key.startsWith("drawer.")) cleared[key] = void 0;
    }
    const next: Record<string, string | undefined> = {
      ...cleared,
      "drawer.open": request.drawer,
    };
    for (const [name, value] of Object.entries(request.params ?? {})) {
      next[`drawer.${name}`] = value;
    }
    this.actions.setQuery(next);
  }
}
