// @vitest-environment jsdom
/**
 * The mount answers `traceFilters()` from the capability analytics lends the shell.
 * Spec: specs/traces/trace-list-page-size-cap.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  UiSession,
  UiTraceFilters,
  type UiActiveScope,
  type UiCapabilities,
  type UiTraceFilterReading,
} from "@langwatch/browser-host/capabilities";
import type { UiScopeStatus, UiSessionSnapshot } from "@langwatch/browser-host/session";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../annotation-api.ts", () => ({
  annotationApi: { organization: { getScopeGraph: { useQuery: () => ({ data: [] }) } } },
}));
vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDrawer: () => ({ openDrawer: () => void 0, drawerOpen: () => false }),
}));

import { useAnnotationHost } from "../../model/annotation-host.ts";
import AnnotationHostMount from "../annotation-host-mount.tsx";

const READING: UiTraceFilterReading = {
  startDate: 1,
  endDate: 2,
  filters: { "topics.topics": ["billing"] },
};

class TestScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "proj-1" };
  }
}

class SignedOutSession extends UiSession {
  constructor(private readonly scopeStatus: UiScopeStatus = "ready") {
    super();
  }

  snapshot(): UiSessionSnapshot {
    return {
      session: { status: "anonymous", user: null },
      scope: { status: this.scopeStatus, organization: void 0, team: void 0, project: void 0 },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => false,
        canInOrganization: () => false,
      },
    };
  }

  currentUser() {
    return null;
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

class LentTraceFilters extends UiTraceFilters {
  applied(): UiTraceFilterReading {
    return READING;
  }
}

function hostUnder({
  traceFilters,
  scopeStatus,
}: {
  traceFilters?: UiTraceFilters | undefined;
  scopeStatus?: UiScopeStatus;
}) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost(
      {
        route: () => ({ params: {}, query: {} }),
        navigate: () => void 0,
      },
      new SignedOutSession(scopeStatus),
    ),
    scope: new TestScope(),
    ...(traceFilters ? { traceFilters } : {}),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <UiCapabilityContextProvider value={capabilities}>
      <AnnotationHostMount>{children}</AnnotationHostMount>
    </UiCapabilityContextProvider>
  );
  return renderHook(() => useAnnotationHost(), { wrapper }).result.current;
}

describe("the annotation host's trace filters", () => {
  describe("given analytics lent the applied filters", () => {
    /** @scenario "The filtered annotations list reads the filters analytics lends" */
    it("answers them as lent", () => {
      expect(hostUnder({ traceFilters: new LentTraceFilters() }).traceFilters()).toBe(READING);
    });
  });

  describe("given no module lent them", () => {
    /** @scenario "A composition with no trace filters lender reads as unfiltered" */
    it("answers no filters", () => {
      expect(hostUnder({}).traceFilters()).toBeUndefined();
    });
  });
});

describe("the annotation host's scope status", () => {
  describe.each<UiScopeStatus>(["loading", "ready", "unavailable"])(
    "given the session reads the active scope as %s",
    (status) => {
      /** @scenario "Annotation queue completion requires a successful read" */
      it("answers that status to the queue walk", () => {
        expect(hostUnder({ scopeStatus: status }).scopeStatus()).toBe(status);
      });
    },
  );
});
