/**
 * @vitest-environment jsdom
 *
 * The evaluations panel's Run via API button opens a dialog with a
 * copyable snippet for the workflow evaluate endpoint.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { RunViaApiButton } from "../RunViaApiButton";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("RunViaApiButton", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the button is clicked", () => {
    /** @scenario The run-via-API dialog shows a copyable snippet for this workflow */
    it("opens a dialog with the curl snippet for this workflow's evaluate endpoint", async () => {
      const user = userEvent.setup();
      render(<RunViaApiButton workflowId="workflow_abc123" />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByTestId("run-via-api"));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Run via API");
      const snippet = dialog.textContent ?? "";
      expect(snippet).toContain("/api/workflows/workflow_abc123/evaluate");
      expect(snippet).toContain("X-Auth-Token");
      expect(snippet).toContain('"parameters"');
    });
  });
});
