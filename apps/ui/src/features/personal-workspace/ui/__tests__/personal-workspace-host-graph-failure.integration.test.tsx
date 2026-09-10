/**
 * `PersonalWorkspaceHost` read the organization graph without checking for a refusal, so a failed `organization.getAll` left the personal-workspace screens with no organization and no error — same gap `TraceHost` and `OrganizationHost` had.
 * @vitest-environment jsdom
 * Spec: specs/auth/session-failure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/user-web/personal-workspace", async () => {
  const actual = await vi.importActual<
    typeof import("@langwatch/user-web/personal-workspace")
  >("@langwatch/user-web/personal-workspace");
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
  UiDocumentTitle,
  UiFeedback,
  UiNavigation,
  UiRoute,
  UiSession,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/ui-host/capabilities";
import { PersonalWorkspaceHost } from "../sections/personal-workspace-host";

class SilentNavigation extends UiNavigation {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class SilentRoute extends UiRoute {
  reading() {
    return { params: {}, query: {} };
  }
  setQuery(): void {}
}

class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  failed(): void {}
}

class SilentTitle extends UiDocumentTitle {
  set(): () => void {
    return () => {};
  }
}

class SignedInSession extends UiSession {
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
      expect(screen.getByText("This could not be loaded right now")).toBeTruthy();
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
