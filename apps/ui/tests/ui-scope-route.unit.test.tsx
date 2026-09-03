/**
 * What the address bar says about the scope, read through the real router.
 *
 * The one rule that had to be restated rather than copied is the
 * personal-workspace test. The application asks whether the MATCHED PATTERN
 * starts with `/me`, which this package answers as "the router matched no
 * project segment, and the first one is `me`". The cases that separate the two
 * readings are the ones that matter: `/me/traces` is a project named `me` in
 * both, and `/mentions` is nobody's personal workspace in either.
 */

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  isUiPublicRoute,
  useUiRouteReading,
  type UiRouteReading,
} from "../src/behavior/ui-scope-route";

const ROUTE_PATHS = [
  "/",
  "/settings/api-keys",
  "/me",
  "/me/sessions",
  "/mentions",
  "/share/:id",
  "/auth/signin",
  "/:project",
  "/:project/traces",
];

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

function readAt(path: string): UiRouteReading {
  let reading: UiRouteReading | undefined;

  function Probe() {
    reading = useUiRouteReading();
    return null;
  }

  const router = createMemoryRouter(
    ROUTE_PATHS.map((routePath) => ({ path: routePath, element: <Probe /> })),
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  if (!reading) throw new Error(`nothing rendered at ${path}`);
  return reading;
}

describe("given an address the router matched", () => {
  describe("when it carries a project segment", () => {
    it("reads the segment as the addressed project", () => {
      expect(readAt("/acme-app/traces").projectParam).toBe("acme-app");
    });

    it("reads a reserved top-level address as a project segment too, unfiltered", () => {
      // The refusal belongs to the resolution, which is where the reserved
      // list lives; the reading states what the router matched.
      expect(readAt("/messages").projectParam).toBe("messages");
    });
  });

  describe("when it carries a team query", () => {
    it("reads it", () => {
      expect(readAt("/settings/api-keys?team=acme").teamParam).toBe("acme");
    });

    it("reads no team when the query names none", () => {
      expect(readAt("/settings/api-keys").teamParam).toBeUndefined();
    });
  });

  describe("when it is the personal workspace's own", () => {
    it("says so for the personal home", () => {
      expect(readAt("/me").isPersonalScopeRoute).toBe(true);
    });

    it("says so for every personal sub-route", () => {
      expect(readAt("/me/sessions").isPersonalScopeRoute).toBe(true);
    });
  });

  describe("when it only looks like the personal workspace's own", () => {
    it("reads a project named 'me' as a project, not as the personal workspace", () => {
      const reading = readAt("/me/traces");

      expect(reading.projectParam).toBe("me");
      expect(reading.isPersonalScopeRoute).toBe(false);
    });

    it("reads an unrelated address that starts with the same letters as no personal page", () => {
      expect(readAt("/mentions").isPersonalScopeRoute).toBe(false);
    });

    it("reads an organization-scoped page as no personal page", () => {
      expect(readAt("/settings/api-keys").isPersonalScopeRoute).toBe(false);
    });
  });

  describe("when it is a share link", () => {
    it("reads the token and says the page needs no session", () => {
      const reading = readAt("/share/token-123");

      expect(reading.shareToken).toBe("token-123");
      expect(reading.isPublicRoute).toBe(true);
    });
  });

  describe("when it is any page behind the session", () => {
    it("says so", () => {
      expect(readAt("/acme-app/traces").isPublicRoute).toBe(false);
      expect(readAt("/acme-app/traces").shareToken).toBe("");
    });
  });
});

describe("given the addresses that render without a session", () => {
  it("names the same ones the application does", () => {
    expect(isUiPublicRoute("/share/anything")).toBe(true);
    expect(isUiPublicRoute("/auth/signin")).toBe(true);
    expect(isUiPublicRoute("/auth/signup")).toBe(true);
    expect(isUiPublicRoute("/auth/forgot-password")).toBe(true);
    expect(isUiPublicRoute("/auth/reset-password")).toBe(true);
    expect(isUiPublicRoute("/auth/verify-email")).toBe(true);
    expect(isUiPublicRoute("/auth/error")).toBe(true);
  });

  it("holds every other address behind it", () => {
    expect(isUiPublicRoute("/")).toBe(false);
    expect(isUiPublicRoute("/me")).toBe(false);
    expect(isUiPublicRoute("/acme-app/traces")).toBe(false);
    expect(isUiPublicRoute("/share")).toBe(false);
  });
});
