/**
 * @vitest-environment jsdom
 *
 * The failure card: the platform's code is selectable on it and one action copies the whole
 * failure.
 * @see specs/langy/langy-cli-tool-envelope.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { presentLangyToolError } from "../../../model/logic/langy-tool-failure.ts";
import { LangyToolErrorCard } from "../langy-tool-error-card.tsx";

const failureDocument = JSON.stringify({
  ok: false,
  error: {
    code: "resource_limit_exceeded",
    message: "You have reached the maximum number of scenarios",
    httpStatus: 403,
    meta: { limitType: "scenarios", current: 3, max: 3 },
    isHandled: true,
  },
});

function renderCard(errorText: string) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyToolErrorCard
        presentation={presentLangyToolError({ title: "Counting traces", errorText })}
      />
    </DesignSystemProvider>,
  );
}

describe("LangyToolErrorCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a failure that carries the platform's code", () => {
    /** @scenario "The whole failure can be copied in one click" */
    it("shows the code as selectable text and copies the whole failure in one click", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
      renderCard(failureDocument);

      const code = screen.getByText("resource_limit_exceeded");
      expect(getComputedStyle(code).userSelect).toBe("text");

      await user.click(screen.getByRole("button", { name: "Copy the error details" }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const copied = String(writeText.mock.calls[0]?.[0]);
      expect(copied).toContain("resource_limit_exceeded");
      expect(copied).toContain("You have reached the maximum number of scenarios");
    });
  });

  describe("given a failure that is a bare traceback", () => {
    const traceback = [
      "Traceback (most recent call last):",
      '  File "/app/langwatch_nlp/count.py", line 42, in count_rows',
      "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
    ].join("\n");

    /** @scenario "The traceback stays reachable behind the disclosure" */
    it("keeps it out of the body and reveals the whole traceback behind Show details", async () => {
      const user = userEvent.setup();
      renderCard(traceback);

      expect(screen.getByText("This step couldn't be completed.")).toBeTruthy();
      expect(screen.queryByText(/JSONDecodeError/)).toBeNull();

      await user.click(screen.getByRole("button", { name: "Show details" }));

      expect(screen.getByText(/JSONDecodeError/).textContent).toBe(traceback);
    });
  });
});
