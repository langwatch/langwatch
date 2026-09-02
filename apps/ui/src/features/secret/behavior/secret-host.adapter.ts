/**
 * The Secret package's host port, answered from this application.
 *
 * `@langwatch/secret-web` declares what its screen needs — the project, one
 * grant, the two notices and the application's project switcher — as one
 * abstract class it can define without importing anything of ours. This is the
 * other half: a plain adapter over what the application shell has already
 * resolved.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in the
 * one component that mounts it.
 */

import {
  SecretHostPort,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "@langwatch/secret-web/screens/secret";
import type { ReactNode } from "react";

/**
 * The grant this key does not carry.
 *
 * The platform page was `SettingsLayout` and nothing else, and read
 * `secrets:manage` INLINE to decide whether the write controls are live. A
 * reader holding only `secrets:view` still sees which secrets exist, which is
 * what someone debugging a code block needs. Inventing a page-level grant here
 * would refuse them a page the product admits today.
 */
export const SECRET_PAGE_PERMISSION = void 0;

export type SecretHostReadings = {
  scope: SecretHostScope;
  projectSwitcher: ReactNode | null;
};

export type SecretHostActions = {
  hasPermission: (permission: string) => boolean;
  succeeded: (notice: SecretSuccessNotice) => void;
  failed: (failure: SecretFailureNotice) => void;
};

export class UiSecretHost extends SecretHostPort {
  static create(readings: SecretHostReadings, actions: SecretHostActions): UiSecretHost {
    return new UiSecretHost(readings, actions);
  }

  private constructor(
    private readonly readings: SecretHostReadings,
    private readonly actions: SecretHostActions,
  ) {
    super();
  }

  scope(): SecretHostScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  succeeded(notice: SecretSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: SecretFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * THE RECORDED GAP, NOW CLOSED.
   *
   * The platform page put `DashboardLayout`'s `ProjectSelector` in its header,
   * and while nothing mounted `DashboardLayout` above a screen served from
   * `apps/ui` this had to answer `null`. The chrome layout route mounts the
   * navigation host above every settings address now, so the answer is the real
   * control — `@langwatch/navigation-web`'s switcher, offering the teams this
   * reader may open and landing on the address they are already on.
   */
  projectSwitcher(): ReactNode | null {
    return this.readings.projectSwitcher;
  }
}
