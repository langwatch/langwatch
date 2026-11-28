/**
 * @vitest-environment jsdom
 * A run the server refuses for a Lite Member seat opens licensing's restriction modal, which
 * offers Request access, instead of a red toast telling them to ask an admin.
 * Spec: modules/organization/specs/seat-requests.feature
 */
import { FetchSSERefusedError } from "@langwatch/browser-host/fetch-sse";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  refusal: undefined as unknown,
  openLiteMemberRestriction: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock("@langwatch/browser-host/fetch-sse", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSSE: async ({ onError }: { onError?: (error: unknown) => void }) => {
    onError?.(boundary.refusal);
  },
}));

vi.mock("@langwatch/browser-host/errors", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showErrorToast: boundary.showErrorToast,
}));

vi.mock("@langwatch/browser-host/lent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLentHooks: () => ({ openLiteMemberRestriction: boundary.openLiteMemberRestriction }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "proj" } }),
}));

vi.mock("@langwatch/experiment-contract", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildExecutionRequest: () => ({ request: { projectId: "project_1" }, executionCells: [] }),
}));

import { useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";
import { useExecuteEvaluation } from "../use-execute-evaluation.ts";

const refusedFor = (code: string) =>
  new FetchSSERefusedError({
    message: "This feature is not available for your account",
    httpStatus: 401,
    body: {
      code,
      message: "This feature is not available for your account",
      meta: { resource: "evaluations" },
    },
  });

describe("useExecuteEvaluation", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    boundary.openLiteMemberRestriction.mockReset();
    boundary.showErrorToast.mockReset();
  });

  describe("when the server refuses Run for a Lite Member seat", () => {
    /** @scenario "Running the workbench as a Lite Member offers Request access" */
    it("opens the restriction modal naming the resource, and shows no red toast", async () => {
      boundary.refusal = refusedFor("lite_member_restricted");
      const { result } = renderHook(() => useExecuteEvaluation());

      await act(async () => {
        await result.current.execute();
      });

      expect(boundary.openLiteMemberRestriction).toHaveBeenCalledWith({ resource: "evaluations" });
      expect(boundary.showErrorToast).not.toHaveBeenCalled();
    });
  });

  describe("when the server refuses Run for another reason", () => {
    it("toasts the refusal and opens no modal", async () => {
      boundary.refusal = refusedFor("developer_seat_restricted");
      const { result } = renderHook(() => useExecuteEvaluation());

      await act(async () => {
        await result.current.execute();
      });

      expect(boundary.openLiteMemberRestriction).not.toHaveBeenCalled();
      expect(boundary.showErrorToast).toHaveBeenCalledTimes(1);
    });
  });
});
