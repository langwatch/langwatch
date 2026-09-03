/**
 * The navigation capability, over the router this package already owns —
 * `react-router` is sealed off from a frontend feature (ADR-004), so a
 * screen gets a `UiNavigationPort` instead, which a test can record.
 */

import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams, type NavigateFunction } from "react-router";
import { UiNavigationPort, UiRoutePort, type UiRouteReadingValues } from "./ui-capabilities";

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
 * Only valid below `RouterProvider` — the application shell mounts it
 * inside the root layout, where every routed screen renders.
 */
export function useRouterUiNavigation(): UiNavigationPort {
  const navigate = useNavigate();
  return useMemo(() => createRouterUiNavigation({ navigate }), [navigate]);
}

/**
 * Params and query arrive as one flat reading. `useSearchParams` keeps a
 * multi-valued map; a repeated key collapses to its last value, since a
 * screen writing `?tab=sources` is asking a single-valued question.
 */
class RouterUiRoute extends UiRoutePort {
  constructor(
    private readonly values: UiRouteReadingValues,
    private readonly write: (
      next: Readonly<Record<string, string | undefined>>,
      options?: { replace?: boolean },
    ) => void,
  ) {
    super();
  }

  reading(): UiRouteReadingValues {
    return this.values;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.write(next, options);
  }
}

/** The reading and the writer, for a test that has neither a router nor a URL. */
export function createUiRoute({
  values,
  setQuery,
}: {
  values: UiRouteReadingValues;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
}): UiRoutePort {
  return new RouterUiRoute(values, setQuery);
}

/** The route capability of the router this render is inside. */
export function useRouterUiRoute(): UiRoutePort {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  return useMemo(() => {
    const query: Record<string, string | undefined> = {};
    searchParams.forEach((value, key) => {
      query[key] = value;
    });

    return createUiRoute({
      values: { params, query },
      setQuery: (next, options) => {
        const written = new URLSearchParams();
        for (const [key, value] of Object.entries(next)) {
          if (value !== void 0) written.set(key, value);
        }
        setSearchParams(written, { replace: options?.replace ?? false });
      },
    });
  }, [params, searchParams, setSearchParams]);
}
