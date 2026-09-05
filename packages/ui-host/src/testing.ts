/**
 * The capabilities a test mounts when it renders a screen outside the shell. In the product the
 * application shell answers `UiRoutePort`, `UiNavigationPort` and `UiFeedbackPort` above every
 * route, and a screen rendered with none of them degrades — an empty address, an inert link.
 */

import {
  BrowserUiDocumentTitle,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilities,
  type UiFailureNotice,
  type UiRouteReadingValues,
  type UiSessionPort,
  type UiSuccessNotice,
} from "./capabilities";

/** What a feature host double answers, loosely enough for every family's port. */
export type UiTestHost = {
  route(): {
    params: Readonly<Record<string, string | string[] | undefined>>;
    query: Readonly<Record<string, string | string[] | undefined>>;
    pathname?: string;
  };
  setQuery?(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;
  navigate(to: string, options?: { replace?: boolean }): void;
  back?(): void;
  succeeded?(notice: UiSuccessNotice): void;
  failed?(failure: UiFailureNotice): void;
};

/** A repeated key arrived as a list; the reading is single-valued. */
function single(
  values: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    flat[key] = Array.isArray(value) ? value[value.length - 1] : value;
  }
  return flat;
}

class HostUiRoute extends UiRoutePort {
  constructor(private readonly host: UiTestHost) {
    super();
  }

  reading(): UiRouteReadingValues {
    const reading = this.host.route();
    return {
      params: single(reading.params),
      query: single(reading.query),
      pathname: reading.pathname,
    };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.host.setQuery?.(next, options);
  }
}

class HostUiNavigation extends UiNavigationPort {
  constructor(private readonly host: UiTestHost) {
    super();
  }

  navigate(to: string): void {
    this.host.navigate(to);
  }

  replace(to: string): void {
    this.host.navigate(to, { replace: true });
  }

  back(): void {
    this.host.back?.();
  }
}

class HostUiFeedback extends UiFeedbackPort {
  constructor(private readonly host: UiTestHost) {
    super();
  }

  succeeded(notice: UiSuccessNotice): void {
    this.host.succeeded?.(notice);
  }

  failed(failure: UiFailureNotice): void {
    this.host.failed?.(failure);
  }
}

/** The capabilities a screen under test reads, answered by the host double. */
export function createUiCapabilitiesFromHost(
  host: UiTestHost,
  session: UiSessionPort = UNAVAILABLE_UI_SESSION,
): UiCapabilities {
  return {
    documentTitle: BrowserUiDocumentTitle.create(),
    session,
    route: new HostUiRoute(host),
    navigation: new HostUiNavigation(host),
    feedback: new HostUiFeedback(host),
  };
}
