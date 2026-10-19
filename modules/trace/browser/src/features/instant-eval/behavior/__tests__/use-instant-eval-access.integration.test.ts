// @vitest-environment jsdom
/**
 * The search bar's Instant Evals access is the server's answer alone.
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const accessQueryMock = vi.fn();

// A guard: the hook no longer reads the flag, so a returning browser flag read meets "on" here
// and only the server's answer can still release.
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: { instantEval: { access: { useQuery: () => accessQueryMock() } } },
}));

import { useInstantEvalAccess } from "../use-instant-eval-access.ts";

beforeEach(() => {
  accessQueryMock.mockReset();
});

describe("useInstantEvalAccess", () => {
  describe("given the server says the project is not released", () => {
    /** @scenario "The search bar takes release from the server, never from its own read of the flag" */
    it("is not available though the browser's flag read says on, and offers what the server names", () => {
      accessQueryMock.mockReturnValue({
        data: { released: false, offer: "enable", viaConnect: false },
        isLoading: false,
      });

      const { result } = renderHook(() => useInstantEvalAccess({ projectId: "project-1" }));

      expect(result.current).toEqual({
        isAvailable: false,
        optInOffer: "enable",
        viaConnect: false,
      });
    });
  });

  describe("given the server says the project is released", () => {
    it("is available", () => {
      accessQueryMock.mockReturnValue({
        data: { released: true, offer: "enable", viaConnect: false },
        isLoading: false,
      });

      const { result } = renderHook(() => useInstantEvalAccess({ projectId: "project-1" }));

      expect(result.current.isAvailable).toBe(true);
    });
  });

  describe("given the server's read is in flight", () => {
    it("counts as available, so a server refusal then says why", () => {
      accessQueryMock.mockReturnValue({ data: undefined, isLoading: true });

      const { result } = renderHook(() => useInstantEvalAccess({ projectId: "project-1" }));

      expect(result.current.isAvailable).toBe(true);
    });
  });
});
