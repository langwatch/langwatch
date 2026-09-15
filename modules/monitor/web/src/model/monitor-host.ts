/**
 * The host port for online evaluation screens; sealed from @langwatch/ui per
 * ADR-004.
 */

import { createContext, useContext } from "react";

/** The project the current page is about. */
export type MonitorScope = {
  projectId: string | undefined;
  projectSlug: string | undefined;
};

/** One project the reader may replicate a monitor into. */
export type MonitorCopyTarget = {
  id: string;
  /** "Organization / Team / Project", as the select renders it. */
  name: string;
  /** Whether the reader may create in it; a closed target is greyed, not hidden. */
  canCreate: boolean;
};

/**
 * A failure, as the screen knows it. The raw `error` travels and never a
 * sentence the screen composed: the wire message of a handled error IS its code
 * slug since #5984.
 */
export type MonitorFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  id?: string;
};

/** A short confirmation of something the reader just did. */
export type MonitorSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/** An overlay this family does not own, named by the address that opens it. */
export type MonitorOverlayRequest = {
  /** The registered drawer's key, e.g. `onlineEvaluation`. */
  drawer: string;
  params?: Readonly<Record<string, string | undefined>>;
};

export type MonitorRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** The one thing a screen is handed. */
export abstract class MonitorHostApi {
  abstract scope(): MonitorScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** Every project the reader could replicate an online evaluation into. */
  abstract copyTargets(): readonly MonitorCopyTarget[];

  /**
   * The reader's time zone, which the performance read buckets by.
   *
   * `platform/app` called `Intl.DateTimeFormat().resolvedOptions().timeZone`
   * inside the page body. That is a browser reading like any other, and putting
   * it on the port is what lets a test pin the buckets a monitor's week is cut
   * into rather than inheriting the machine running the suite.
   */
  abstract timeZone(): string;

  abstract route(): MonitorRouteReading;

  abstract navigate(to: string): void;

  abstract openOverlay(request: MonitorOverlayRequest): void;

  abstract succeeded(notice: MonitorSuccessNotice): void;
  abstract failed(failure: MonitorFailureNotice): void;
}

const MonitorHostContext = createContext<MonitorHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const MonitorHostProvider = MonitorHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useMonitorHost(): MonitorHostApi {
  const host = useContext(MonitorHostContext);
  if (!host) {
    throw new Error(
      "No monitor host is mounted above this screen; render it inside the monitor frontend feature.",
    );
  }
  return host;
}
