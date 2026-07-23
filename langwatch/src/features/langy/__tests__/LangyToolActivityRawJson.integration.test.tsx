/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

/**
 * The raw tool payload is never shown by default — not even in developer
 * mode. It sits behind the `{}` toggle, which itself exists only in developer
 * mode. The regression: the JSON block rode the CARD's expansion state, so a
 * completed card's auto-opened receipt dumped `{ "tool": … }` into the chat
 * without the toggle ever being clicked.
 */

const devModeRef = { current: true };
vi.mock("../hooks/useLangyDevMode", () => ({
  useLangyDevMode: () => [devModeRef.current, vi.fn()],
}));

const { LangyToolActivity } = await import("../components/LangyToolActivity");

function skillMessage(): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "tool-skill",
        toolCallId: "call-1",
        state: "output-available",
        input: {
          name: "experiments",
          description:
            "Create and run LangWatch experiments for pre-deployment batch testing.",
        },
        output: "<skill_content>…</skill_content>",
      } as never,
    ],
  };
}

function renderActivity() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyToolActivity message={skillMessage()} />
    </ChakraProvider>,
  );
}

describe("Langy tool activity raw payload", () => {
  describe("given developer mode is on", () => {
    it("keeps the JSON hidden until the {} toggle is clicked", async () => {
      devModeRef.current = true;
      const user = userEvent.setup();
      const { container } = renderActivity();

      // The completed receipt is open — but the payload is not in it.
      expect(container.textContent).not.toContain('"tool"');
      expect(container.textContent).not.toContain("output-available");

      await user.click(
        screen.getByRole("button", { name: "Show raw data" }),
      );

      expect(container.textContent).toContain('"tool": "skill"');
      expect(container.textContent).toContain("output-available");
      // Inspecting the payload did not collapse the card it belongs to.
      expect(
        screen.getByRole("button", { name: "Hide raw data" }),
      ).toBeInTheDocument();
    });
  });

  describe("given developer mode is off", () => {
    it("offers no raw-data affordance at all", () => {
      devModeRef.current = false;
      const { container } = renderActivity();

      expect(
        screen.queryByRole("button", { name: /raw data/i }),
      ).not.toBeInTheDocument();
      expect(container.textContent).not.toContain('"tool"');
    });
  });
});
