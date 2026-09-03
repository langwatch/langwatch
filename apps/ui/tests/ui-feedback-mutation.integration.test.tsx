/**
 * @vitest-environment jsdom
 *
 * A rejected mutation, from the wire to the words on screen.
 *
 * The unit tests pin the resolution rules; this one pins that they are what a
 * reader actually gets. A screen's `onError` hands the raw error to the
 * feedback capability and names the action, and what appears is the client
 * presentation registry's copy for that CODE — not the screen's fallback, and
 * emphatically not the wire message, which since #5984 is the slug
 * `service_unavailable` (ADR-045, amendment 2026-07-21).
 *
 * It renders the real toaster, so the copy is asserted where a customer reads
 * it rather than on the object handed to it.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { toaster } from "@langwatch/design-system/toaster";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserUiFeedback } from "../src/behavior/ui-feedback";
import {
  UiCapabilityContextProvider,
  useUiCapabilities,
  type UiCapabilities,
} from "../src/behavior/ui-capabilities";
import { UiErrorToaster } from "../src/ui/elements/ui-error-toaster";

// The Design System's toaster is a module singleton, so a toast raised by one
// case is still in its store when the next renders and every query would match
// twice. `remove` drops them outright; `dismiss` only starts the exit
// animation, which has not finished by the time the next case renders.
afterEach(() => {
  toaster.remove();
  cleanup();
});

/**
 * A handled error as the tRPC boundary sends it: the code in `data.error`, and
 * the message collapsed to that same slug. A screen that rendered `message`
 * would put "service_unavailable" in front of the reader.
 */
function serviceUnavailable(): Error {
  return Object.assign(new Error("service_unavailable"), {
    data: {
      httpStatus: 503,
      traceId: "0af7651916cd43dd8448eb211c80319c",
      error: {
        code: "service_unavailable",
        httpStatus: 503,
        fault: "platform",
        traceId: "0af7651916cd43dd8448eb211c80319c",
      },
    },
  });
}

/** A screen with one action, wired the way every moved family wires theirs. */
function RunButton() {
  const { feedback } = useUiCapabilities();
  const start = useMutation({
    mutationFn: () => Promise.reject(serviceUnavailable()),
    retry: false,
    onError: (error) => feedback.failed({ error, fallbackTitle: "Couldn't start the run" }),
  });

  return (
    <button type="button" onClick={() => start.mutate()}>
      Run topic clustering
    </button>
  );
}

function mount() {
  const capabilities = { feedback: BrowserUiFeedback.create() } as unknown as UiCapabilities;

  return render(
    <ChakraProvider value={defaultSystem}>
      <QueryClientProvider client={new QueryClient()}>
        <UiCapabilityContextProvider value={capabilities}>
          <RunButton />
          <UiErrorToaster />
        </UiCapabilityContextProvider>
      </QueryClientProvider>
    </ChakraProvider>,
  );
}

describe("given a mutation that fails with a coded handled error", () => {
  describe("when the screen hands it to the feedback capability", () => {
    it("shows the registry's copy for the code, not the screen's fallback", async () => {
      mount();

      fireEvent.click(screen.getByRole("button", { name: "Run topic clustering" }));

      expect(await screen.findByText("This deployment doesn't offer that")).toBeTruthy();
      expect(
        await screen.findByText(
          "The service behind this action isn't part of this deployment. Ask whoever runs it whether it can be enabled.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("Couldn't start the run")).toBeNull();
    });

    it("never shows the wire message, which is the code slug", async () => {
      mount();

      fireEvent.click(screen.getByRole("button", { name: "Run topic clustering" }));

      await screen.findByText("This deployment doesn't offer that");
      expect(document.body.textContent).not.toContain("service_unavailable");
    });

    it("offers the trace id so the reader can quote the failure to support", async () => {
      mount();

      fireEvent.click(screen.getByRole("button", { name: "Run topic clustering" }));

      await screen.findByText("This deployment doesn't offer that");
      expect(document.body.textContent).toContain("0af7651916cd43dd8448eb211c80319c");
    });
  });
});
