/**
 * The Ops package's host port, answered from this application.
 *
 * `@langwatch/ops-web` declares what its fourteen screens, its six drawers and
 * its queue and process surfaces need — whether the reader is an operator,
 * whether they are an admin, the project they are standing in, this address and
 * the two feedback notices — as one abstract class it can define without
 * importing anything of ours. This is the other half: a plain adapter over the
 * capabilities the application shell already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * THE TWO ACCESS ANSWERS ARE SESSION GRANTS, and that is the whole of the admin
 * gate. `platform/app` asked a live `ops.getScope` probe for the workspace and a
 * separate `user.isAdmin` read for the Backoffice, deliberately decoupled so
 * that widening one could never widen the other. Both facts are already in the
 * session capability as platform-tier permissions — `ops:view` reads,
 * `ops:manage` writes, declared as `scope: ["platform"]` in the authz registry
 * — so the adapter reads them from there and the decoupling survives: a reader
 * with `ops:view` and no `ops:manage` sees the workspace and is refused the
 * Backoffice.
 */

import type { OpsProject, OpsRouteReading } from "@langwatch/ops-web/screens/ops";
import { OpsHostPort } from "@langwatch/ops-web/screens/ops";

/** The grant the Ops workspace is behind. */
export const OPS_VIEW_PERMISSION = "ops:view";

/** The strictly narrower grant the Backoffice is behind. */
export const OPS_MANAGE_PERMISSION = "ops:manage";

export type OpsHostReadings = {
  project: OpsProject | undefined;
  route: OpsRouteReading;
  /** Path, query and fragment; Deja View keeps its workspace in the last one. */
  asPath: string;
  /** From the deployment's public config: shared installs warn about fleet reach. */
  sharedInstall: boolean;
};

export type OpsHostActions = {
  hasPermission: (permission: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: { title: string; description?: string; id?: string }) => void;
  failed: (failure: { error: unknown; fallbackTitle: string; id?: string }) => void;
};

export class UiOpsHost extends OpsHostPort {
  static create(readings: OpsHostReadings, actions: OpsHostActions): UiOpsHost {
    return new UiOpsHost(readings, actions);
  }

  private constructor(
    private readonly readings: OpsHostReadings,
    private readonly actions: OpsHostActions,
  ) {
    super();
  }

  /** Fails closed: an answer that has not arrived reads as no. */
  hasOpsAccess(): boolean {
    return this.actions.hasPermission(OPS_VIEW_PERMISSION);
  }

  isOpsAdmin(): boolean {
    return this.actions.hasPermission(OPS_MANAGE_PERMISSION);
  }

  sharedInstall(): boolean {
    return this.readings.sharedInstall;
  }

  project(): OpsProject | undefined {
    return this.readings.project;
  }

  route(): OpsRouteReading {
    return this.readings.route;
  }

  asPath(): string {
    return this.readings.asPath;
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

  succeeded(notice: { title: string; description?: string; id?: string }): void {
    this.actions.succeeded(notice);
  }

  failed(failure: { error: unknown; fallbackTitle: string; id?: string }): void {
    this.actions.failed(failure);
  }
}
