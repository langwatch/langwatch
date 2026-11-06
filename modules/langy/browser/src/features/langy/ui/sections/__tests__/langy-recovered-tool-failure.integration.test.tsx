/**
 * @vitest-environment jsdom
 *
 * A failed step folds into the receipt of the work with the steps that worked, running or
 * answered. It keeps its card only where the reader has to act on it.
 * @see specs/langy/langy-card-taxonomy.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/use-langy-dev-mode.ts", () => ({
  useLangyDevMode: () => [false, vi.fn()],
}));

const { LangyToolActivity } = await import("../langy-tool-activity.tsx");

function failedProbe(id = "call-1") {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-error",
    input: { command: "langwatch docs integration/python/openai --format json" },
    errorText: "error: unknown option '--format'",
  } as never;
}

const deniedStep = {
  type: "tool-bash",
  toolCallId: "call-denied",
  state: "output-denied",
  input: { command: "rm -rf build" },
} as never;

const reply = {
  type: "text",
  text: "Opened pull request #1 with the tracing changes.",
} as never;

function renderActivity({
  parts,
  live,
  answeredAfter = false,
}: {
  parts: UIMessage["parts"];
  live: boolean;
  answeredAfter?: boolean;
}) {
  const message: UIMessage = { id: "assistant-1", role: "assistant", parts };
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyToolActivity message={message} live={live} answeredAfter={answeredAfter} />
    </DesignSystemProvider>,
  );
}

/** The receipt's header: the one disclosure that summarises the work. */
function receiptHeader(): HTMLElement {
  return screen.getByRole("button", { name: /tool call/ });
}

describe("a failed step", () => {
  describe("given the turn answered after the failure", () => {
    /** @scenario "A failed step folds into the record of the work" */
    it("folds the failure into the receipt rather than a card", () => {
      const { container } = renderActivity({ parts: [failedProbe(), reply], live: false });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptHeader().textContent).toContain("1 failed");
      expect(container.textContent).not.toContain("This step couldn't be completed.");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("marks the row failed, never that Langy carried on", () => {
      const { container } = renderActivity({ parts: [failedProbe(), reply], live: false });

      expect(screen.getByRole("button", { name: /failed/, expanded: false })).toBeTruthy();
      expect(container.textContent).not.toContain("carried on");
    });

    /** @scenario "A failed step folds into the record of the work" */
    it("opens the row into the card it always showed", async () => {
      const user = userEvent.setup();
      const { container } = renderActivity({ parts: [failedProbe(), reply], live: false });

      await user.click(screen.getByRole("button", { name: /failed/, expanded: false }));

      expect(container.textContent).toContain("This step couldn't be completed.");
      expect(container.textContent).toContain("unknown option '--format'");
    });
  });

  describe("given the reply is a separate run of the turn", () => {
    /** @scenario "A failed step folds into the record of the work" */
    it("folds the failure the run cannot see the reply from", () => {
      // MessageContent splits a turn into runs, so an activity run holds only
      // its own parts and cannot see the answer that followed it. The caller
      // says so instead.
      renderActivity({ parts: [failedProbe()], live: false, answeredAfter: true });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptHeader().textContent).toContain("1 failed");
    });
  });

  describe("given the turn is still running", () => {
    /** @scenario "A step that fails while the turn is running folds into the record too" */
    it("folds the failure into the receipt while the reader watches", () => {
      const { container } = renderActivity({ parts: [failedProbe()], live: true });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptHeader().textContent).toContain("1 failed");
      expect(container.textContent).not.toContain("This step couldn't be completed.");
    });
  });

  describe("given three steps failed while Langy worked", () => {
    /** @scenario "The record of the work counts its failures quietly" */
    it("counts them in the receipt header", () => {
      renderActivity({
        parts: [failedProbe("call-1"), failedProbe("call-2"), failedProbe("call-3")],
        live: true,
      });

      expect(screen.queryByRole("alert")).toBeNull();
      expect(receiptHeader().textContent).toContain("3 tool calls · 3 failed");
    });
  });

  describe("given the turn never answered after the failure", () => {
    /** @scenario "A step the turn never recovered from keeps its card" */
    it("keeps the card", () => {
      const { container } = renderActivity({ parts: [failedProbe()], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
      expect(container.textContent).toContain("This step couldn't be completed.");
    });
  });

  describe("given the person denied the step", () => {
    /** @scenario "A step the person denied keeps its card" */
    it("keeps the card while the turn runs", () => {
      renderActivity({ parts: [deniedStep], live: true });

      expect(screen.getByRole("alert")).toBeTruthy();
    });

    /** @scenario "A step the person denied keeps its card" */
    it("keeps the card after the turn answered", () => {
      renderActivity({ parts: [deniedStep, reply], live: false });

      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });
});
