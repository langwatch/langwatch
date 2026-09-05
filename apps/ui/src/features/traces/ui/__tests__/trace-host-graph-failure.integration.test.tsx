/**
 * `TraceHost` reads the project, team and organization off `organization.getAll` the same way `ProjectHomeHostSection` does, but it did not carry the shell's failure handling: a refused read left `isLoading` false and `placement` forever undefined, so the trace explorer never resolved into a spinner, an error, or the page — it just sat there.
 * @vitest-environment jsdom
 * Spec: specs/auth/session-failure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/trace-web/screens/traces", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/trace-web/screens/traces")>(
    "@langwatch/trace-web/screens/traces",
  );
  return {
    ...actual,
    traceApi: {
      organization: {
        getAll: {
          useQuery: () => ({ data: void 0, error: graph.error, isLoading: false }),
        },
      },
    },
  };
});

vi.mock("../../../../behavior/ui-departure", () => ({
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
import { TraceHost } from "../sections/trace-host";

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

class SignedInSession extends UiSessionPort {
  currentUser() {
    return { id: "user-1", name: "Reader", email: "reader@example.com", image: null };
  }
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "project-1" };
  }
  hasPermission(): boolean {
    return true;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return false;
  }
}

function mountTraces() {
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new SignedInSession(),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/project-1/traces"]}>
        <UiCapabilityContextProvider value={capabilities}>
          <TraceHost>
            <div>the trace explorer</div>
          </TraceHost>
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

describe("given the organization graph refuses for a reason the reader can read", () => {
  describe("when the trace shell renders", () => {
    /** @scenario "A refused organization graph renders its handled failure, never a blank page" */
    it("renders the registered copy instead of hanging on an empty document", () => {
      graph.error = {
        data: {
          error: {
            code: "clickhouse_unavailable",
            httpStatus: 503,
            traceId: "trace_01J9Z",
          },
        },
      };

      mountTraces();

      expect(departures).toEqual([]);
      expect(screen.getByText("Search is temporarily unavailable")).toBeTruthy();
      expect(screen.queryByText("the trace explorer")).toBeNull();
    });
  });
});

describe("given the organization graph answered", () => {
  describe("when the trace shell renders", () => {
    it("renders what it is mounted around", () => {
      mountTraces();

      expect(departures).toEqual([]);
      expect(screen.getByText("the trace explorer")).toBeTruthy();
    });
  });
});
