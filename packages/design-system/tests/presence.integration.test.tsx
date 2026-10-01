/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PresenceAvatarStack, type PresencePeer } from "../src/components/presence.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function peer(sessionId: string, displayName: string): PresencePeer {
  return { sessionId, displayName, color: "blue.emphasized", image: null, detail: displayName };
}

function renderStack(peers: PresencePeer[], max?: number) {
  return renderWithDesignSystem(<PresenceAvatarStack peers={peers} max={max} />);
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
      renderStack([peer("a", "Alice"), peer("b", "Bob")]);
      expect(screen.getByLabelText("2 viewers")).toBeInTheDocument();
    });
  });

  describe("when peer count exceeds max", () => {
    it("collapses the overflow into a +N badge", () => {
      renderStack([peer("a", "Alice"), peer("b", "Bob"), peer("c", "Cy")], 2);
      expect(screen.getByText("+1")).toBeInTheDocument();
    });
  });
});
