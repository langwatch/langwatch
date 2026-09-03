/**
 * @vitest-environment jsdom
 *
 * See specs/licensing/expired-license-enforcement.feature — a license past its
 * end date keeps metering the seats it sold, so the page has to say what
 * actually changed (nothing, except room to grow) and still show the over-seats
 * callout. A license we did not sign says nothing at all and must not be
 * mistaken for a lapsed one.
 *
 * Moved from `platform/app/src/components/__tests__/LicenseStatus.integration.test.tsx`
 * with the component, renamed `LicenseStatusPanel` on the way in.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LicenseStatus as LicenseStatusPayload } from "@langwatch/enterprise-licensing-contract";
import { LicenseStatusPanel } from "../license-status-panel";

const { statusResult } = vi.hoisted(() => ({
  statusResult: { current: undefined as unknown },
}));

vi.mock("../../../behavior/licensing-api", () => ({
  licensingApi: {
    license: {
      getStatus: {
        useQuery: () => ({
          data: statusResult.current,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("../use-license-actions", () => ({
  useLicenseActions: () => ({
    upload: vi.fn(),
    remove: vi.fn(),
    isUploading: false,
    isRemoving: false,
  }),
}));

vi.mock("../license-generator-drawer", () => ({
  LicenseGeneratorDrawer: () => null,
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const resourceCounts = {
  currentMembers: 8,
  maxMembers: 5,
  currentMembersLite: 0,
  maxMembersLite: 5,
  currentMessagesPerMonth: 0,
  maxMessagesPerMonth: 1_000_000,
};

const lapsedStatus: LicenseStatusPayload = {
  hasLicense: true,
  valid: false,
  expired: true,
  plan: "ENTERPRISE",
  planName: "Enterprise",
  expiresAt: "2020-01-01T00:00:00Z",
  organizationName: "Acme Corp",
  ...resourceCounts,
};

const unsignedStatus: LicenseStatusPayload = {
  ...lapsedStatus,
  expired: false,
};

const renderWith = (status: LicenseStatusPayload) => {
  statusResult.current = status;
  render(
    <LicenseStatusPanel
      organizationId="org-123"
      isGeneratorOpen={false}
      onGeneratorOpenChange={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
};

describe("LicenseStatusPanel", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a license whose term has ended", () => {
    /** @scenario The license page says what the lapse changed and what it did not */
    it("says nothing was switched off and names what renewal buys back", () => {
      renderWith(lapsedStatus);

      expect(screen.getByText("Expired")).toBeDefined();
      expect(screen.getByText(/Nothing was switched off/i)).toBeDefined();
      expect(screen.getByText(/stay as they are/i)).toBeDefined();
      expect(screen.getByText(/Renew to add members again/i)).toBeDefined();
    });

    /** @scenario An organization over the seats of a lapsed license is asked to reconcile */
    it("still asks an over-seats organization to reconcile", () => {
      renderWith(lapsedStatus);

      expect(screen.getByTestId("over-seats-callout")).toBeDefined();
      expect(screen.getByText(/3 members are over the seats your license covers/i)).toBeDefined();
    });
  });

  describe("given a license we did not sign", () => {
    /** @scenario A license we did not sign is not called expired */
    it("calls it invalid and meters nothing, even though it claims a past date", () => {
      renderWith(unsignedStatus);

      expect(screen.getByText("Invalid")).toBeDefined();
      expect(screen.getByText(/Your license is invalid/i)).toBeDefined();
      expect(screen.queryByText(/Nothing was switched off/i)).toBeNull();
      expect(screen.queryByTestId("over-seats-callout")).toBeNull();
    });
  });
});
