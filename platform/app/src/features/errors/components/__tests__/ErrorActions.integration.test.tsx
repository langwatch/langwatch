/**
 * @vitest-environment jsdom
 *
 * The error id is the only technical detail a customer ever sees, and on the
 * anonymous share surface it is the only handle they have to quote to support.
 * So the interesting cases here are the ones where copying it does NOT work.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ErrorActions } from "../ErrorActions";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TRACE_ID = "4bf92f3577b34da6";

const renderActions = (props: Parameters<typeof ErrorActions>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ErrorActions {...props} />
    </ChakraProvider>,
  );

const withClipboard = (writeText: () => Promise<void>) => {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
};

describe("<ErrorActions />", () => {
  describe("given a clipboard that accepts the write", () => {
    /** @scenario "Technical detail stops at the trace id" */
    it("copies the id and confirms it", async () => {
      const writeText = vi.fn<() => Promise<void>>().mockResolvedValue();
      withClipboard(writeText);

      renderActions({ traceId: TRACE_ID });

      await userEvent.click(
        await screen.findByRole("button", { name: /copy error id/i }),
      );

      expect(writeText).toHaveBeenCalledWith(TRACE_ID);
      expect(await screen.findByText("Copied")).toBeInTheDocument();
    });

    it("does not also print the id as text, which would say it twice", async () => {
      withClipboard(vi.fn<() => Promise<void>>().mockResolvedValue());

      renderActions({ traceId: TRACE_ID });
      await screen.findByRole("button", { name: /copy error id/i });

      expect(screen.queryByText(/Error ID:/)).not.toBeInTheDocument();
    });
  });

  describe("given a clipboard that refuses the write", () => {
    /**
     * Routine in Safari and on an unfocused document. `hasFailed` only clears
     * on a later success, so the button reads "Couldn't copy" for good — and
     * the `!canCopy` text branch never fires, because the API exists and it
     * was only the write that was denied. That left the id unobtainable.
     */
    /** @scenario "An error id stays readable where it cannot be copied" */
    it("falls back to the id as selectable text", async () => {
      withClipboard(
        vi.fn<() => Promise<void>>().mockRejectedValue(new Error("denied")),
      );

      renderActions({ traceId: TRACE_ID });

      await userEvent.click(
        await screen.findByRole("button", { name: /copy error id/i }),
      );

      expect(await screen.findByText("Couldn't copy")).toBeInTheDocument();
      expect(screen.getByText(/4bf92f3577b34da6/)).toBeInTheDocument();
    });
  });

  describe("given no clipboard API at all", () => {
    /** @scenario "An error id stays readable where it cannot be copied" */
    it("shows the id as text instead of a button that cannot work", () => {
      vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });

      renderActions({ traceId: TRACE_ID });

      expect(screen.getByText(/4bf92f3577b34da6/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /copy error id/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given nothing to offer", () => {
    it("renders nothing rather than an empty row", () => {
      const { container } = renderActions({});

      expect(container).toBeEmptyDOMElement();
    });
  });
});
