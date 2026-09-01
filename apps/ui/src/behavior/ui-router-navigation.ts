/**
 * The navigation capability, over the router this package already owns.
 *
 * `react-router` is one of the imports ADR-004 seals off from a frontend
 * feature, so the binding lives here in global behaviour and reaches a screen
 * as a `UiNavigationPort`. That is also what makes a screen's navigation
 * assertable: a test hands it a recording port instead of a router.
 */

import { useMemo } from "react";
import { useNavigate, type NavigateFunction } from "react-router";
import { UiNavigationPort } from "./ui-capabilities";

class RouterUiNavigation extends UiNavigationPort {
  constructor(private readonly navigateTo: NavigateFunction) {
    super();
  }

  navigate(to: string): void {
    void this.navigateTo(to);
  }

  replace(to: string): void {
    void this.navigateTo(to, { replace: true });
  }

  back(): void {
    void this.navigateTo(-1);
  }
}

/** The port over a router's navigate function, for tests and for the hook. */
export function createRouterUiNavigation({
  navigate,
}: {
  navigate: NavigateFunction;
}): UiNavigationPort {
  return new RouterUiNavigation(navigate);
}

/**
 * The navigation capability of the router this render is inside.
 *
 * Only valid below `RouterProvider`; the application shell mounts it inside
 * the root layout, which is where every routed screen renders.
 */
export function useRouterUiNavigation(): UiNavigationPort {
  const navigate = useNavigate();
  return useMemo(() => createRouterUiNavigation({ navigate }), [navigate]);
}
