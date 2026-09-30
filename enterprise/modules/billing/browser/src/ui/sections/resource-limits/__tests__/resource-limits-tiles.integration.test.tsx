/**
 * @vitest-environment jsdom
 *
 * specs/licensing/license-page-styling.feature: where usage against limits is read.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResourceLimitsDisplay } from "../resource-limits-display.tsx";

vi.mock("../../../../behavior/lent-resource-limit-row.tsx", () => ({
  ResourceLimitRow: ({ label, current, max }: { label: string; current: number; max?: number }) => (
    <div data-testid={`limit-${label}`}>
      {max === undefined ? `${current}` : `${current} / ${max}`}
    </div>
  ),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const limits = {
  members: { current: 4, max: 100 },
  membersLite: { current: 0, max: 50 },
  messagesPerMonth: { current: 184, max: 10_000 },
};

afterEach(() => cleanup());

describe("ResourceLimitsDisplay", () => {
  describe("given limits that are shown", () => {
    /** @scenario Usage against each limit is read on the Usage page */
    it("shows each resource as current against its limit, lite members included on request", () => {
      render(<ResourceLimitsDisplay limits={limits} showLimits showLiteMembers />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("limit-Team members").textContent).toBe("4 / 100");
      expect(screen.getByTestId("limit-Lite members").textContent).toBe("0 / 50");
      expect(screen.getByTestId("limit-Events / month").textContent).toBe("184 / 10000");
    });

    /** @scenario Usage against each limit is read on the Usage page */
    it("names the usage row after traces when asked", () => {
      render(<ResourceLimitsDisplay limits={limits} messagesLabel="Traces / month" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByTestId("limit-Traces / month").textContent).toBe("184");
      expect(screen.queryByTestId("limit-Lite members")).toBeNull();
    });
  });

  describe("given a tile that leads the row", () => {
    /** @scenario The plan leads the usage tiles */
    it("draws it before the usage tiles", () => {
      render(
        <ResourceLimitsDisplay limits={limits} leading={<div data-testid="lead">Plan</div>} />,
        { wrapper: Wrapper },
      );

      const lead = screen.getByTestId("lead");
      const members = screen.getByTestId("limit-Team members");
      expect(lead.compareDocumentPosition(members) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
