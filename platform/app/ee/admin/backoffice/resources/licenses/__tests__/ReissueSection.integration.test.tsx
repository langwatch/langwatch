/**
 * @vitest-environment jsdom
 *
 * Reissuing from the license drawer. The signed license is handed over once and
 * stored nowhere, so what keeps it on screen is the subject here.
 *
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReissueSection } from "../ReissueSection";
import type { License } from "../types";

const invalidate = vi.fn().mockResolvedValue(undefined);
let onReissued: ((result: { licenseKey: string }) => void) | null = null;

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate } }),
    licenseRegistry: {
      reissue: {
        useMutation: (options: {
          onSuccess: (result: { licenseKey: string }) => void;
        }) => {
          onReissued = options.onSuccess;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

const ISSUED = new Date("2026-09-19T12:00:00.000Z");
const TERM_END = new Date("2027-09-19T12:00:00.000Z");
const SIGNED = "eyJyZWlzc3VlZCI6dHJ1ZX0=.signature";

function license(overrides: Partial<License> = {}): License {
  return {
    id: "il_1",
    licenseId: "lic-1",
    organizationId: "org_1",
    organizationName: "ACME Rockets",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 5,
    issuedAt: ISSUED,
    expiresAt: TERM_END,
    status: "active",
    ...overrides,
  } as License;
}

function renderSection(value: License) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ReissueSection license={value} />
    </ChakraProvider>,
  );
}

describe("ReissueSection", () => {
  describe("given an operator reissued a license and the new one is shown", () => {
    /** @scenario The signed license stays on screen while its row refreshes */
    it("keeps it on screen when the registry refetches the same license", async () => {
      const { rerender } = renderSection(license());
      await act(async () => {
        onReissued?.({ licenseKey: SIGNED });
      });
      expect(screen.getByDisplayValue(SIGNED)).toBeTruthy();

      // The refetch the reissue triggered hands the drawer a new object for
      // the same row.
      await act(async () => {
        rerender(
          <ChakraProvider value={defaultSystem}>
            <ReissueSection license={license({ maxMembers: 80 })} />
          </ChakraProvider>,
        );
      });

      expect(screen.getByDisplayValue(SIGNED)).toBeTruthy();
    });

    it("clears it when the drawer moves to another license", async () => {
      const { rerender } = renderSection(license());
      await act(async () => {
        onReissued?.({ licenseKey: SIGNED });
      });

      await act(async () => {
        rerender(
          <ChakraProvider value={defaultSystem}>
            <ReissueSection license={license({ id: "il_2" })} />
          </ChakraProvider>,
        );
      });

      expect(screen.queryByDisplayValue(SIGNED)).toBeNull();
    });
  });
});
