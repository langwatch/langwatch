/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LimitType } from "../../server/license-enforcement";
import { checkCompoundLimits } from "../useCompoundLicenseCheck";
import { useLicenseEnforcement } from "../useLicenseEnforcement";

type LimitState = { allowed: boolean; current: number; max: number };

/**
 * Per-limit-type answers the mocked `checkLimit` query hands back. Driving
 * the REAL `useLicenseEnforcement` from here (rather than faking
 * `checkAndProceed`) keeps the chaining under test honest: if the hook ever
 * stopped opening the modal, or opened it with the wrong numbers, these
 * tests fail rather than agreeing with a stand-in.
 */
const limitStates = new Map<string, LimitState>();
const mockOpenUpgradeModal = vi.fn();
const mockReportBlocked = vi.fn();

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ organization: { id: "org-123" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    licenseEnforcement: {
      checkLimit: {
        useQuery: (input: { limitType: string }) => ({
          data: limitStates.get(input.limitType),
          isLoading: false,
        }),
      },
      reportLimitBlocked: {
        useMutation: () => ({ mutate: mockReportBlocked }),
      },
    },
  },
}));

vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (
    selector: (state: { open: typeof mockOpenUpgradeModal }) => unknown,
  ) => selector({ open: mockOpenUpgradeModal }),
}));

/** Two real enforcement handles, in the order the drawers chain them. */
function renderPair(first: LimitType, second: LimitType) {
  const { result } = renderHook(() => ({
    first: useLicenseEnforcement(first),
    second: useLicenseEnforcement(second),
  }));
  return result;
}

describe("checkCompoundLimits", () => {
  beforeEach(() => {
    limitStates.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a create that needs both a workflow and an agent", () => {
    describe("when the workflows limit is exhausted", () => {
      /** @scenario "A compound create blocked by the workflow limit reports workflows" */
      it("reports workflows and creates nothing", () => {
        limitStates.set("workflows", { allowed: false, current: 3, max: 3 });
        limitStates.set("agents", { allowed: true, current: 2, max: 5 });
        const result = renderPair("workflows", "agents");
        const create = vi.fn();

        checkCompoundLimits(
          [result.current.first, result.current.second],
          create,
        );

        expect(mockOpenUpgradeModal).toHaveBeenCalledTimes(1);
        expect(mockOpenUpgradeModal).toHaveBeenCalledWith("workflows", 3, 3);
        expect(create).not.toHaveBeenCalled();
      });
    });

    describe("when only the agents limit is exhausted", () => {
      /** @scenario "A compound create blocked by the second limit in the chain reports that resource" */
      it("reports agents and creates nothing", () => {
        limitStates.set("workflows", { allowed: true, current: 2, max: 5 });
        limitStates.set("agents", { allowed: false, current: 3, max: 3 });
        const result = renderPair("workflows", "agents");
        const create = vi.fn();

        checkCompoundLimits(
          [result.current.first, result.current.second],
          create,
        );

        expect(mockOpenUpgradeModal).toHaveBeenCalledTimes(1);
        expect(mockOpenUpgradeModal).toHaveBeenCalledWith("agents", 3, 3);
        expect(create).not.toHaveBeenCalled();
      });
    });

    describe("when both limits still have room", () => {
      /** @scenario "A compound create runs exactly once when every limit in the chain allows it" */
      it("creates once and opens no modal", () => {
        limitStates.set("workflows", { allowed: true, current: 2, max: 5 });
        limitStates.set("agents", { allowed: true, current: 2, max: 5 });
        const result = renderPair("workflows", "agents");
        const create = vi.fn();

        checkCompoundLimits(
          [result.current.first, result.current.second],
          create,
        );

        expect(create).toHaveBeenCalledTimes(1);
        expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a create with no limits to check", () => {
    /** @scenario "A compound create with no limits to check proceeds immediately" */
    it("creates once and opens no modal", () => {
      const create = vi.fn();

      checkCompoundLimits([], create);

      expect(create).toHaveBeenCalledTimes(1);
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
    });
  });
});
