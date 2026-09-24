/**
 * @vitest-environment jsdom
 *
 * Spec: specs/self-hosting/checkup/startup-notice.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    checkup: {
      dismissStartupNotice: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

import { StartupNoticeBanner } from "../StartupNoticeBanner";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

describe("StartupNoticeBanner", () => {
  describe("when an administrator sees the notice", () => {
    /** @scenario "The notice names the two pages and can be dismissed" */
    it("links the telemetry docs and the checkup page, and records the dismissal", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <StartupNoticeBanner organizationId="org_1" schemaVersion={2} />
        </ChakraProvider>,
      );

      expect(
        screen.getByRole("link", { name: /open checkup/i }),
      ).toHaveAttribute("href", "/settings/checkup");
      expect(
        screen.getByRole("link", { name: /what is sent/i }),
      ).toHaveAttribute(
        "href",
        "https://docs.langwatch.ai/self-hosting/data-and-telemetry",
      );

      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

      expect(mutate).toHaveBeenCalledWith({
        organizationId: "org_1",
        schemaVersion: 2,
      });
      expect(screen.queryByTestId("startup-notice")).not.toBeInTheDocument();
    });
  });
});
