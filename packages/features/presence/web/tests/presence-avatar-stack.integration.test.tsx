// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PresenceSession } from "@langwatch/presence-contract";
import { PresenceAvatarStack } from "../src";

afterEach(cleanup);

function session(sessionId: string, name: string): PresenceSession {
  return {
    sessionId,
    projectId: "project-1",
    user: { id: sessionId, name, image: null },
    location: { lens: "traces", route: {} },
    updatedAt: 0,
  };
}

function renderStack(sessions: PresenceSession[], max?: number) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PresenceAvatarStack sessions={sessions} max={max} />
    </ChakraProvider>,
  );
}

describe("given the presence avatar stack", () => {
  describe("when there are no peers", () => {
    it("renders nothing", () => {
      const { container } = renderStack([]);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("when peer count is within max", () => {
    it("labels the cluster with the exact viewer count", () => {
      renderStack([session("a", "Alice"), session("b", "Bob")]);
      expect(screen.getByLabelText("2 viewers")).toBeInTheDocument();
    });
  });

  describe("when peer count exceeds max", () => {
    it("collapses the overflow into a +N badge", () => {
      renderStack(
        [session("a", "Alice"), session("b", "Bob"), session("c", "Cy")],
        2,
      );
      expect(screen.getByText("+1")).toBeInTheDocument();
    });
  });
});
