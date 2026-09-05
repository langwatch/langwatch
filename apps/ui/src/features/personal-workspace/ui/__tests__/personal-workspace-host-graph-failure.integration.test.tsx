/**
 * @vitest-environment jsdom
 *
 * `PersonalWorkspaceHost` read the organization graph without checking for
 * a refusal, so a failed `organization.getAll` left the personal-workspace
 * screens with no organization and no error — same gap `TraceHost` and
 * `OrganizationHost` had.
 *
 * Spec: specs/auth/session-failure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/user-web/screens/personal-workspace", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/user-web/screens/personal-workspace")
  >("@langwatch/user-web/screens/personal-workspace");
  return {
    ...actual,
    personalWorkspaceApi: {
      organization: {
        getAll: {
          useQuery: () => ({
            data: void 0,
            error: graph.error,
            isLoading: false,
            isSuccess: false,
          }),
        },
      },
    },
  };
});

vi.mock("../../../../behavior/ui-session-refresh", () => ({
  useRefreshUiSession: () => async () => {},
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
import { PersonalWorkspaceHost } from "../sections/personal-workspace-host";

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

function mountPersonalWorkspace() {
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new SignedInSession(),
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/settings/profile"]}>
        <UiCapabilityContextProvider value={capabilities}>
          <PersonalWorkspaceHost>
            <div>the personal workspace screen</div>
          </PersonalWorkspaceHost>
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
  describe("when the personal workspace shell renders", () => {
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

      mountPersonalWorkspace();

      expect(departures).toEqual([]);
      expect(screen.getByText("Search is temporarily unavailable")).toBeTruthy();
      expect(screen.queryByText("the personal workspace screen")).toBeNull();
    });
  });
});

describe("given the organization graph answered", () => {
  describe("when the personal workspace shell renders", () => {
    it("renders what it is mounted around", () => {
      mountPersonalWorkspace();

      expect(departures).toEqual([]);
      expect(screen.getByText("the personal workspace screen")).toBeTruthy();
    });
  });
});
