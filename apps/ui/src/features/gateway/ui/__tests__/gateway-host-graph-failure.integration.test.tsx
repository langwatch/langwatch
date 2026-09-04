/**
 * @vitest-environment jsdom
 *
 * `GatewayHost` read the organization graph without checking for a refusal,
 * so a failed `organization.getAll` left the gateway screens with no scope
 * and no error — same gap `TraceHost` and `OrganizationHost` had.
 *
 * Spec: specs/auth/session-failure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/gateway-web/screens/gateway", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/gateway-web/screens/gateway")>(
    "@langwatch/gateway-web/screens/gateway",
  );
  return {
    ...actual,
    gatewayApi: {
      organization: {
        getAll: {
          useQuery: () => ({ data: void 0, error: graph.error, isLoading: false }),
        },
      },
      limits: {
        getUsage: {
          useQuery: () => ({ data: void 0, isLoading: false }),
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
} from "../../../../behavior/ui-capabilities";
import { GatewayHost } from "../sections/gateway-host";

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

function mountGateway() {
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new SignedInSession(),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/settings/gateway"]}>
        <UiCapabilityContextProvider value={capabilities}>
          <GatewayHost>
            <div>the gateway screen</div>
          </GatewayHost>
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
  describe("when the gateway shell renders", () => {
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

      mountGateway();

      expect(departures).toEqual([]);
      expect(screen.getByText("Search is temporarily unavailable")).toBeTruthy();
      expect(screen.queryByText("the gateway screen")).toBeNull();
    });
  });
});

describe("given the organization graph answered", () => {
  describe("when the gateway shell renders", () => {
    it("renders what it is mounted around", () => {
      mountGateway();

      expect(departures).toEqual([]);
      expect(screen.getByText("the gateway screen")).toBeTruthy();
    });
  });
});
