/**
 * @vitest-environment jsdom
 *
 * The legacy Traces page and the legacy trace drawer both render this banner
 * to warn that the view is going away. What is under test is the warning copy
 * and the "Open Trace Explorer" CTA target: the page variant lands on the
 * Trace Explorer, and the drawer variant (which carries a traceId) deep-links
 * the same trace into the Trace Explorer drawer.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { slug: "acme" } }),
}));

import { LegacyTracesDeprecationBanner } from "../LegacyTracesDeprecationBanner";

// The CTA navigates with `window.location.href`. jsdom does not implement
// navigation, so stand a writable stub in its place and read back the value
// the banner assigned.
const originalLocation = window.location;

function renderBanner(ui: ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("LegacyTracesDeprecationBanner", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "/acme/messages" },
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  describe("when shown on the legacy Traces page", () => {
    /** @scenario "The legacy Traces page warns that it is going away" */
    it("warns the view is going away and offers to open the Trace Explorer", async () => {
      const user = userEvent.setup();
      renderBanner(<LegacyTracesDeprecationBanner />);

      expect(screen.getByText("This view is going away soon")).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /open trace explorer/i }),
      );

      expect(window.location.href).toBe("/acme/traces");
    });
  });

  describe("when shown inside the legacy trace drawer", () => {
    /** @scenario "The legacy trace drawer warns that it is going away" */
    it("warns and opens the same trace in the Trace Explorer drawer", async () => {
      const user = userEvent.setup();
      renderBanner(
        <LegacyTracesDeprecationBanner variant="compact" traceId="trace-xyz" />,
      );

      expect(screen.getByText("This view is going away soon")).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /open trace explorer/i }),
      );

      expect(window.location.href).toBe(
        "/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace-xyz",
      );
    });
  });
});
