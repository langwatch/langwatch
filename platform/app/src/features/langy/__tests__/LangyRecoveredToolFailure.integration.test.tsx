/**
 * @vitest-environment jsdom
 *
 * A failed step the turn then recovered from.
 *
 * A filmed run left three red "Running a command failed" cards standing for
 * three self-corrected probes — a flag the command did not take, then the same
 * command without it — beside a reply that had gone on to open a pull request.
 * The reader had to decide about each one.
 *
 * @see specs/langy/langy-card-taxonomy.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useLangyDevMode", () => ({
  useLangyDevMode: () => [false, vi.fn()],
}));

const { LangyToolActivity } = await import("../components/LangyToolActivity");

const failedProbe = {
  type: "tool-bash",
  toolCallId: "call-1",
  state: "output-error",
  input: { command: "langwatch docs integration/python/openai --format json" },
  errorText: "error: unknown option '--format'",
} as never;

const reply = {
  type: "text",
  text: "Opened pull request #1 with the tracing changes.",
} as never;

function renderActivity(parts: UIMessage["parts"]) {
  const message: UIMessage = { id: "assistant-1", role: "assistant", parts };
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyToolActivity message={message} live={false} />
    </ChakraProvider>,
  );
}

describe("a failed step on a settled turn", () => {
  describe("given the turn answered after the failure", () => {
    /** @scenario "A step the turn recovered from folds to one line" */
    it("folds the failure to one line rather than a card", () => {
      const { container } = renderActivity([failedProbe, reply]);

      expect(container.textContent).toContain("and Langy carried on");
      expect(container.textContent).not.toContain(
        "This step couldn't be completed.",
      );
    });

    /** @scenario "A step the turn recovered from folds to one line" */
    it("opens into the card it always showed", async () => {
      const user = userEvent.setup();
      const { container } = renderActivity([failedProbe, reply]);

      await user.click(screen.getByRole("button", { expanded: false }));

      expect(container.textContent).toContain(
        "This step couldn't be completed.",
      );
      expect(container.textContent).toContain("unknown option '--format'");
    });
  });

  describe("given the turn never answered after the failure", () => {
    /** @scenario "A step the turn never recovered from keeps its card" */
    it("keeps the card", () => {
      const { container } = renderActivity([failedProbe]);

      expect(container.textContent).toContain(
        "This step couldn't be completed.",
      );
      expect(container.textContent).not.toContain("and Langy carried on");
    });
  });

  describe("given the turn is still running", () => {
    it("keeps the card while the reader is watching it happen", () => {
      const message: UIMessage = {
        id: "assistant-1",
        role: "assistant",
        parts: [failedProbe, reply],
      };
      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <LangyToolActivity message={message} live={true} />
        </ChakraProvider>,
      );

      expect(container.textContent).toContain(
        "This step couldn't be completed.",
      );
    });
  });
});
