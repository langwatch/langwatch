/**
 * `OpsHost` read the organization graph without checking for a refusal, so a failed `organization.getAll` left the ops screens with no project and no error — same gap `TraceHost` and `OrganizationHost` had.
 * @vitest-environment jsdom
 * Spec: specs/auth/session-failure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/ops-web/screens/ops", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/ops-web/screens/ops")>(
    "@langwatch/ops-web/screens/ops",
  );
  return {
    ...actual,
    opsApi: {
      organization: {
        getAll: {
          useQuery: () => ({ data: void 0, error: graph.error, isLoading: false }),
        },
      },
    },
  };
});

vi.mock("../../../../behavior/ui-address", () => ({
  useUiAddress: () => "/ops",
}));

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
import { OpsHost } from "../sections/ops-host";

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

function mountOps() {
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new SignedInSession(),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/ops"]}>
        <UiCapabilityContextProvider value={capabilities}>
          <OpsHost>
            <div>the ops screen</div>
          </OpsHost>
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
  describe("when the ops shell renders", () => {
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

      mountOps();

      expect(departures).toEqual([]);
      expect(screen.getByText("Search is temporarily unavailable")).toBeTruthy();
      expect(screen.queryByText("the ops screen")).toBeNull();
    });
  });
});

describe("given the organization graph answered", () => {
  describe("when the ops shell renders", () => {
    it("renders what it is mounted around", () => {
      mountOps();

      expect(departures).toEqual([]);
      expect(screen.getByText("the ops screen")).toBeTruthy();
    });
  });
});
