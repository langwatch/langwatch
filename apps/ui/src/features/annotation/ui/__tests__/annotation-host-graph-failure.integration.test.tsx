/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const graph = vi.hoisted(() => ({ error: null as unknown }));
const departures = vi.hoisted(() => [] as string[]);

vi.mock("@langwatch/annotation-web/annotations", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/annotation-web/annotations")>(
    "@langwatch/annotation-web/annotations",
  );

  return {
    ...actual,
    annotationApi: {
      organization: {
        getAll: {
          useQuery: () => ({ data: void 0, error: graph.error, isLoading: false }),
        },
      },
    },
  };
});

vi.mock("../../../../behavior/ui-organization-facts", () => ({
  useUiOrganizationFacts: () => ({
    isEnterprise: false,
    isPlanLoading: false,
    isLiteMember: false,
    isSaaS: false,
  }),
  useUiPlatformAdmin: () => false,
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
import { AnnotationHost } from "../sections/annotation-host";

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

function mountAnnotations() {
  const capabilities: UiCapabilities = {
    documentTitle: new SilentTitle(),
    feedback: new SilentFeedback(),
    navigation: new SilentNavigation(),
    route: new SilentRoute(),
    session: new SignedInSession(),
  };

  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/project-1/annotations"]}>
        <UiCapabilityContextProvider value={capabilities}>
          <AnnotationHost>
            <div>the annotations screen</div>
          </AnnotationHost>
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
  describe("when the annotations shell renders", () => {
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

      mountAnnotations();

      expect(departures).toEqual([]);
      expect(screen.getByText("This could not be loaded right now")).toBeTruthy();
      expect(screen.queryByText("the annotations screen")).toBeNull();
    });
  });
});

describe("given the organization graph answered", () => {
  describe("when the annotations shell renders", () => {
    it("renders what it is mounted around", () => {
      mountAnnotations();

      expect(departures).toEqual([]);
      expect(screen.getByText("the annotations screen")).toBeTruthy();
    });
  });
});
