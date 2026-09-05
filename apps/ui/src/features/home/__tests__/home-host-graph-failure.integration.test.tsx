/**
 * @vitest-environment jsdom
 *
 * A refused `organization.getAll` used to render an empty document: the host
 * exposed only `isLoading`, which a 401 leaves false, so every screen inside
 * the shell was told the graph had settled and held no organization. The two
 * refusals are answered differently — one is "we do not know who you are" and
 * goes to sign-in, the other is copy the reader can act on plus a trace id.
 *
 * Spec: specs/auth/session-failure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/project-web/screens/home", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/project-web/screens/home")>(
    "@langwatch/project-web/screens/home",
  );
  return {
    ...actual,
    homeApi: {
      organization: {
        getAll: {
          useQuery: () => ({ data: void 0, error: graph.error, isLoading: false }),
        },
      },
    },
  };
});

vi.mock("../../../behavior/ui-departure", () => ({
  uiLeaveTo: (url: string) => departures.push(url),
  uiOpenExternal: () => {},
}));

import {
  UiCapabilityContextProvider,
  UiDocumentTitlePort,
  UiFeedbackPort,
  UiNavigationPort,
  UiRoutePort,
  UiSessionPort,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/ui-host/capabilities";
import { ProjectHomeHostSection } from "../ui/sections/home-host";

class SilentNavigation extends UiNavigationPort {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoutePort {
  reading() {
    return { params: {}, query: {} };
  }
  setQuery(): void {}
}

class SilentFeedback extends UiFeedbackPort {
  succeeded(): void {}
  failed(): void {}
}

class SilentTitle extends UiDocumentTitlePort {
  set(): () => void {
    return () => {};
  }
}

/** Nobody resolved, which is what a refused graph leaves behind. */
class EmptySession extends UiSessionPort {
  currentUser(): null {
    return null;
  }
  activeScope(): UiActiveScope {
    return { organizationId: null, projectId: null };
  }
  hasPermission(): boolean {
    return false;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return false;
  }
}

function mountHome() {
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new EmptySession(),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/local-dev-project"]}>
        <UiCapabilityContextProvider value={capabilities}>
          <ProjectHomeHostSection>
            <div>the project home</div>
          </ProjectHomeHostSection>
        </UiCapabilityContextProvider>
      </MemoryRouter>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  graph.error = null;
  departures.length = 0;
});
afterEach(cleanup);

describe("given the organization graph refuses because nobody is signed in", () => {
  describe("when the shell renders", () => {
    /** @scenario "A refused organization graph sends an unauthenticated reader to sign in" */
    it("sends the reader to the sign-in screen carrying the address they asked for", () => {
      graph.error = { data: { httpStatus: 401, code: "UNAUTHORIZED" } };

      mountHome();

      expect(departures).toEqual(["/auth/signin?callbackUrl=%2Flocal-dev-project"]);
      expect(screen.queryByText("the project home")).toBeNull();
    });
  });
});

describe("given the read refused because the session itself could not be read", () => {
  describe("when the shell renders", () => {
    /** @scenario "A refused organization graph sends an unauthenticated reader to sign in" */
    it("sends the reader to the sign-in screen too", () => {
      graph.error = { data: { error: { code: "session_read_failed", httpStatus: 503 } } };

      mountHome();

      expect(departures).toEqual(["/auth/signin?callbackUrl=%2Flocal-dev-project"]);
    });
  });
});

describe("given the organization graph refuses for a reason the reader can read", () => {
  describe("when the shell renders", () => {
    /** @scenario "A refused organization graph renders its handled failure, never a blank page" */
    it("renders the registered copy and the trace id instead of an empty document", () => {
      graph.error = {
        data: {
          error: {
            code: "clickhouse_unavailable",
            httpStatus: 503,
            traceId: "trace_01J9Z",
          },
        },
      };

      mountHome();

      expect(departures).toEqual([]);
      expect(screen.getByText("Search is temporarily unavailable")).toBeTruthy();
      expect(screen.getByText(/trace_01J9Z/)).toBeTruthy();
      expect(screen.queryByText("the project home")).toBeNull();
    });
  });
});

describe("given the organization graph answered", () => {
  describe("when the shell renders", () => {
    it("renders what it is mounted around", () => {
      mountHome();

      expect(departures).toEqual([]);
      expect(screen.getByText("the project home")).toBeTruthy();
    });
  });
});
