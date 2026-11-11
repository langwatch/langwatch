/**
 * Moving from a project with a conversation open to the personal workspace (/me) never reads
 * that conversation under the personal project: each such read answers "not found".
 * @vitest-environment jsdom
 * @see specs/langy/langy-context-awareness.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEAM_PROJECT = "project-team";
const PERSONAL_PROJECT = "project-personal";
const TEAM_CONVERSATION = "conv-team";

// The auto-resizing textarea reaches for ResizeObserver on mount, which jsdom lacks.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

/** Every conversation read the panel asked the server for: which one, and under which project. */
const reads: { procedure: string; projectId: string; conversationId: string }[] = [];

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ currentDrawer: null }),
}));
vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../../../../behavior/langy-api.ts", async () => {
  const { createTrpcUtils, idleQuery, modelProviderRouter, withFallback } =
    await import("../../../__tests__/support/langy-api-mock.ts");
  const recordingRead =
    (procedure: string) =>
    (input: { projectId: string; conversationId: string }, opts?: { enabled?: boolean }) => {
      if (opts?.enabled !== false) reads.push({ procedure, ...input });
      return idleQuery();
    };
  const trpcUtils = createTrpcUtils();
  return {
    api: withFallback({
      langy: withFallback({
        messages: { useQuery: recordingRead("messages") },
        localRecord: { useQuery: recordingRead("localRecord") },
        getLocalWorkspace: { useQuery: recordingRead("getLocalWorkspace") },
        modelsAllowed: {
          useQuery: () => ({ data: { modelsAllowed: null }, isLoading: false, isError: false }),
        },
        onConversationUpdate: { useSubscription: () => undefined },
      }),
      useUtils: () => trpcUtils,
      useContext: () => trpcUtils,
      modelProvider: modelProviderRouter(),
    }),
  };
});

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import {
  LangyHostApi,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";
import { LangyProvider } from "../../../../tools/ui/sections/langy-page-context.tsx";
import { LangySidecar } from "../langy-panel.tsx";

/** The host, already on the personal workspace the user just opened. */
class PersonalWorkspaceHost extends LangyHostApi {
  project() {
    return { id: PERSONAL_PROJECT, slug: "me", name: "me" };
  }
  organization() {
    return { id: "org-1" };
  }
  team() {
    return { id: "team-personal", isPersonal: true, members: [{ userId: "user-1" }] };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasOrganizationPermission() {
    return false;
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/me" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">
    <LangyHostProvider value={new PersonalWorkspaceHost()}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
  </DesignSystemProvider>
);

describe("Langy panel reads after a move to the personal workspace", () => {
  beforeEach(() => {
    reads.length = 0;
    // The project's conversation is still the open one when the personal workspace mounts.
    useLangyStore.setState({
      isOpen: true,
      activeConversationId: TEAM_CONVERSATION,
      activeConversationScope: {
        userId: "user-1",
        organizationId: "org-1",
        projectId: TEAM_PROJECT,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a project conversation was open", () => {
    /** @scenario A message still on its way stays where I sent it */
    it("never asks for that conversation under the personal project", async () => {
      render(<LangySidecar />, { wrapper: Wrapper });

      await waitFor(() => expect(useLangyStore.getState().activeConversationId).toBeNull());
      expect(reads.filter((read) => read.conversationId === TEAM_CONVERSATION)).toEqual([]);
    });
  });

  describe("given the conversation belongs to the personal workspace", () => {
    it("reads it there", async () => {
      useLangyStore.setState({
        activeConversationScope: {
          userId: "user-1",
          organizationId: "org-1",
          projectId: PERSONAL_PROJECT,
        },
      });

      render(<LangySidecar />, { wrapper: Wrapper });

      await waitFor(() =>
        expect(reads).toContainEqual({
          procedure: "messages",
          projectId: PERSONAL_PROJECT,
          conversationId: TEAM_CONVERSATION,
        }),
      );
    });
  });
});
