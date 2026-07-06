/**
 * @vitest-environment jsdom
 *
 * Regression guard for #4469: proves the global `afterEach(cleanup)` registered
 * in `test-setup.ts` unmounts portaled content between tests, so role-based
 * queries stay deterministic in CI.
 *
 * This file deliberately does NOT register its own `afterEach(cleanup)`. The
 * only unmount between its two tests comes from the shared setup file, so the
 * second test can see exactly one dialog only if the global hook ran. Remove
 * that global hook and the second test sees two leaked dialogs and fails, which
 * is the exact accumulation that made `getByRole`/`getAllByRole` flake.
 */
import { render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, expect, it } from "vitest";

// Mirrors how Chakra dialogs mount: React content is portaled straight into
// document.body rather than into the render container.
const PortaledDialog = () =>
  createPortal(<div role="dialog">portaled dialog content</div>, document.body);

describe("given the global afterEach(cleanup) from test-setup", () => {
  describe("when a portaled dialog is rendered across consecutive tests", () => {
    it("mounts exactly one dialog on the first render", () => {
      render(<PortaledDialog />);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("still sees exactly one dialog on the next render, proving no accumulation", () => {
      render(<PortaledDialog />);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });
  });
});
