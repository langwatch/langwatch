/**
 * Real-Chromium QA for the errored Output cell. jsdom can assert the tooltip
 * node exists, but it cannot prove that a real pointer hover surfaces the full
 * message above a two-line clamp. This drives an actual browser hover and
 * captures a screenshot of the revealed tooltip for the PR.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

import { BatchTargetCell } from "../BatchTargetCell";
import type { BatchTargetOutput } from "../types";

const longError =
  "gateway chat/completions: provider_error: the upstream model returned an " +
  "error after exhausting all retries. Detail: rate limit exceeded for the " +
  "organization on requests per minute. Please retry after the cooldown window.";

const erroredOutput: BatchTargetOutput = {
  targetId: "target-1",
  output: null,
  cost: null,
  duration: null,
  error: longError,
  traceId: null,
  evaluatorResults: [],
};

afterEach(() => cleanup());

describe("errored Output cell in real Chromium", () => {
  describe("when the user hovers the clamped error", () => {
    it("reveals the full error message in a tooltip", async () => {
      await page.viewport(640, 360);
      render(
        <ChakraProvider value={defaultSystem}>
          <div style={{ width: 320, padding: 24 }}>
            <BatchTargetCell targetOutput={erroredOutput} />
          </div>
        </ChakraProvider>,
      );

      await userEvent.hover(screen.getByTestId("error-output-target-1"));

      const tooltip = await screen.findByTestId("error-tooltip-target-1");
      await waitFor(() => expect(tooltip).toBeVisible());
      expect(tooltip).toHaveTextContent(longError);

      await page.screenshot({ path: "/tmp/pr4289/eval-error-tooltip.png" });
    });
  });
});
