/**
 * @vitest-environment jsdom
 *
 * The card taxonomy primitive: each intent renders at its own attention weight,
 * and the governing rule holds — warmth is earned, so only the two heaviest
 * intents (`ask`, `spotlight`) spend the amber accent while the lower-weight
 * receipts stay on the quiet neutral hairline.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LangyCard } from "../components/LangyCard";
import { CARD_INTENTS, CARD_TAXONOMY } from "../tokens";

function ui(node: React.ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);
}

const ACCENT_INTENTS = ["ask", "spotlight"] as const;

describe("LangyCard taxonomy", () => {
  describe("given the activity intent (lowest weight)", () => {
    it("renders an inline status line, not a boxed card", () => {
      const { container } = ui(
        <LangyCard intent="activity" title="Reading the checkout traces" />,
      );
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(container.querySelector(".langy-accent-wash")).toBeNull();
    });
  });

  describe("given the ask intent (a decision)", () => {
    it("spends the warm accent — the wash and the ring", () => {
      const { container } = ui(
        <LangyCard intent="ask" title="Add a faithfulness evaluator?" />,
      );
      expect(container.querySelector(".langy-accent-wash")).not.toBeNull();
      expect(container.querySelector(".langy-accent-ring")).not.toBeNull();
    });
  });

  describe("given the spotlight intent (a headline result)", () => {
    it("renders the full panel material, not a plain box", () => {
      const { container } = ui(
        <LangyCard intent="spotlight" title="34 traces matched" />,
      );
      // LangyPanelSurface stacks the panel textures behind the content.
      expect(container.querySelector(".langy-root")).not.toBeNull();
      expect(container.querySelector(".langy-signal-grid")).not.toBeNull();
      expect(container.querySelector(".langy-accent-wash")).not.toBeNull();
    });
  });

  describe("when rendering every intent", () => {
    it("earns warmth — only a decision and a headline result carry the accent", () => {
      for (const intent of CARD_INTENTS) {
        const { container, unmount } = ui(
          <LangyCard intent={intent} title="x" overline="y" />,
        );
        const warm = container.querySelector(".langy-accent-wash") !== null;
        expect(warm).toBe(
          (ACCENT_INTENTS as readonly string[]).includes(intent),
        );
        unmount();
      }
    });
  });

  describe("given the taxonomy definition", () => {
    it("orders the five intents by ascending attention weight", () => {
      const weights = CARD_INTENTS.map((i) => CARD_TAXONOMY[i].weight);
      expect(weights).toEqual([1, 2, 3, 4, 5]);
    });

    it("marks accent true only on the two heaviest intents", () => {
      for (const intent of CARD_INTENTS) {
        expect(CARD_TAXONOMY[intent].accent).toBe(
          (ACCENT_INTENTS as readonly string[]).includes(intent),
        );
      }
    });
  });
});
