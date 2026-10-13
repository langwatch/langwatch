// @vitest-environment jsdom

import { defineSlice } from "@langwatch/browser-host/global-store";
import "@testing-library/jest-dom/vitest";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  PRESENCE_ABSENT,
  PRESENCE_SESSIONS_SLICE,
  type PresenceLocation,
  type PresenceSession,
  type PresenceState,
} from "@langwatch/presence-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SectionPresenceDot } from "../section-presence-dot.tsx";

afterEach(cleanup);

// Stands in for presence, the owner of the slice, which this package only reads.
const usePresenceStore = defineSlice<PresenceState>({
  name: PRESENCE_SESSIONS_SLICE,
  create: (set) => ({
    ...PRESENCE_ABSENT,
    applyEvent: (event) => {
      if (event.kind === "snapshot") {
        set({ sessions: new Map(event.sessions.map((s) => [s.sessionId, s])) });
      }
    },
    reset: () => set({ sessions: new Map() }),
  }),
});

beforeEach(() => {
  usePresenceStore.getState().reset();
  usePresenceStore.setState({ selfSessionId: null });
});

type DrawerTab = NonNullable<PresenceLocation["view"]>["tab"];

function session(traceId: string, tab: DrawerTab, section: string): PresenceSession {
  return {
    sessionId: "peer-1",
    projectId: "project-1",
    user: { id: "peer-1", name: "Alice", image: null },
    location: { lens: "traces", route: { traceId }, view: { tab, section } },
    updatedAt: 0,
  };
}

describe("given a section presence dot", () => {
  describe("when no peer matches the exact trace/tab/section triplet", () => {
    it("renders nothing", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [session("trace-1", "summary", "input")],
      });

      const { container } = renderWithDesignSystem(
        <SectionPresenceDot traceId="trace-1" tab="summary" section="output" />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("when a peer matches the exact trace/tab/section triplet", () => {
    it("renders the presence marker", () => {
      usePresenceStore.getState().applyEvent({
        kind: "snapshot",
        sessions: [session("trace-1", "summary", "input")],
      });

      renderWithDesignSystem(
        <SectionPresenceDot traceId="trace-1" tab="summary" section="input" />,
      );
      expect(screen.getByLabelText("Alice is here · input section")).toBeInTheDocument();
    });
  });
});
