/** @vitest-environment jsdom */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

/**
 * The raw tool payload is never shown by default — not even in developer mode. It sits
 * behind the `{}` toggle, which itself exists only in developer mode.
 */

const devModeRef = { current: true };
// Only developer mode is stubbed; the rest of the package is the real thing,
// because the card under test renders through several of its other exports.
vi.mock("../../../../../behavior/use-langy-dev-mode.ts", () => ({
  useLangyDevMode: () => [devModeRef.current, vi.fn()],
}));

const { LangyToolActivity } = await import("../langy-tool-activity.tsx");

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
          description: "Create and run LangWatch experiments for pre-deployment batch testing.",
        },
        output: "<skill_content>…</skill_content>",
      } as never,
    ],
  };
}

function cardlessCliMessage(): UIMessage {
  return {
    id: "assistant-2",
    role: "assistant",
    parts: [
      {
        type: "tool-bash",
        toolCallId: "call-2",
        state: "output-available",
        input: { command: "langwatch docs integration/python/openai" },
        output: "# OpenAI integration\nInstall the SDK.",
      } as never,
    ],
  };
}

function renderActivity(message: UIMessage = skillMessage()) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyToolActivity message={message} />
    </DesignSystemProvider>,
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

      await user.click(screen.getByRole("button", { name: "Show raw data" }));

      expect(container.textContent).toContain('"tool": "skill"');
      expect(container.textContent).toContain("output-available");
      // Inspecting the payload did not collapse the card it belongs to.
      expect(screen.getByRole("button", { name: "Hide raw data" })).toBeInTheDocument();
    });
  });

  describe("given developer mode is off", () => {
    it("offers no raw-data affordance at all", () => {
      devModeRef.current = false;
      const { container } = renderActivity();

      expect(screen.queryByRole("button", { name: /raw data/i })).not.toBeInTheDocument();
      expect(container.textContent).not.toContain('"tool"');
    });
  });

  describe("given a LangWatch CLI command that has no card", () => {
    /** @scenario "A CLI command with no card for it falls back to raw activity" */
    it("renders it as activity and keeps its raw payload inspectable", async () => {
      devModeRef.current = true;
      const user = userEvent.setup();
      const { container } = renderActivity(cardlessCliMessage());

      expect(container.textContent).toContain("Ran a command");
      expect(container.textContent).not.toContain("call-2");

      await user.click(screen.getByRole("button", { name: "Show raw data" }));

      expect(container.textContent).toContain("langwatch docs integration/python/openai");
      expect(container.textContent).toContain("output-available");
    });
  });
});
