// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PresenceLocation, PresenceSession } from "@langwatch/presence-contract";
import { SectionPresenceDot, usePresenceStore } from "../src";

afterEach(cleanup);

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

      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <SectionPresenceDot traceId="trace-1" tab="summary" section="output" />
        </ChakraProvider>,
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

      render(
        <ChakraProvider value={defaultSystem}>
          <SectionPresenceDot traceId="trace-1" tab="summary" section="input" />
        </ChakraProvider>,
      );
      expect(screen.getByLabelText("Alice is here · input section")).toBeInTheDocument();
    });
  });
});
