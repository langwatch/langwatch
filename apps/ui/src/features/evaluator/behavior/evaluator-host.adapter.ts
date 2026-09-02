/**
 * The evaluator package's host port, answered from this application.
 *
 * `@langwatch/evaluator-web` declares what its screen needs — the project in
 * scope, the reader's grants, the projects an evaluator may be replicated into,
 * the address, the two notices and the overlays it does not own — as one
 * abstract class it can define without importing anything of ours. This is the
 * other half: a plain adapter over the capabilities the application shell
 * already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * THE CHROME GAP IS THIS SIDE'S, and it is recorded rather than papered over.
 * Three of the screen's actions write a `?drawer.open=…` address —
 * `evaluatorEditor`, `codeEvaluatorEditor` and `evaluatorCategorySelector`.
 * Those drawers are registered in `platform/app` and mounted by
 * `DashboardPageBody`, which is application chrome a screen served from
 * `apps/ui` has nothing above it to supply. So the address changes and nothing
 * opens, exactly as the coding-agent, me, automations, annotations and
 * analytics families recorded for the same registry. The address is still the
 * right thing to write: it is what makes the overlay come back for free when
 * the chrome layout route lands, and it is what a shared link already means.
 */

import type {
  EvaluatorCopyTarget,
  EvaluatorFailureNotice,
  EvaluatorOverlayRequest,
  EvaluatorRouteReading,
  EvaluatorScope,
  EvaluatorSuccessNotice,
} from "@langwatch/evaluator-web/screens/evaluators";
import { EvaluatorHostPort } from "@langwatch/evaluator-web/screens/evaluators";

/** The grant the platform page carried, unchanged. */
export const EVALUATORS_PAGE_PERMISSION = "evaluations:view";

/** The grant a replication target is judged by. Evaluators live under evaluations. */
export const EVALUATOR_COPY_PERMISSION = "evaluations:manage";

/**
 * How an overlay this family does not own is addressed.
 *
 * `platform/app`'s drawer registry reads `drawer.open` plus one query parameter
 * per prop, which is what `openDrawer(key, props)` wrote. Spelling it once, here,
 * is what keeps the convention out of a screen.
 */
export function overlayQuery(request: EvaluatorOverlayRequest): Record<string, string | undefined> {
  return {
    "drawer.open": request.drawer,
    ...Object.fromEntries(
      Object.entries(request.params ?? {}).map(([key, value]) => [`drawer.${key}`, value]),
    ),
  };
}

export type EvaluatorHostReadings = {
  scope: EvaluatorScope;
  hasPermission: (permission: string) => boolean;
  copyTargets: readonly EvaluatorCopyTarget[];
  route: EvaluatorRouteReading;
};

export type EvaluatorHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  succeeded: (notice: EvaluatorSuccessNotice) => void;
  failed: (failure: EvaluatorFailureNotice) => void;
};

export class UiEvaluatorHost extends EvaluatorHostPort {
  static create(readings: EvaluatorHostReadings, actions: EvaluatorHostActions): UiEvaluatorHost {
    return new UiEvaluatorHost(readings, actions);
  }

  private constructor(
    private readonly readings: EvaluatorHostReadings,
    private readonly actions: EvaluatorHostActions,
  ) {
    super();
  }

  scope(): EvaluatorScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  copyTargets(): readonly EvaluatorCopyTarget[] {
    return this.readings.copyTargets;
  }

  route(): EvaluatorRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  openOverlay(request: EvaluatorOverlayRequest): void {
    this.actions.setQuery({ ...this.readings.route.query, ...overlayQuery(request) });
  }

  succeeded(notice: EvaluatorSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: EvaluatorFailureNotice): void {
    this.actions.failed(failure);
  }
}
