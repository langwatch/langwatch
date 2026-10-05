/**
 * How long the browser keeps the deployment's public settings.
 *
 * They carry the sign-in providers the Connect offers are drawn from, so a
 * cache that outlives a server restart keeps offering a provider the operator
 * already removed.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("~/utils/api", () => ({
  api: { publicEnv: { useQuery: useQueryMock } },
}));

import { PUBLIC_ENV_QUERY_OPTIONS, usePublicEnv } from "../usePublicEnv";

describe("usePublicEnv", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue({ data: undefined });
  });

  describe("when the settings are read", () => {
    /** @scenario A provider the deployment stopped offering leaves the Connect offers on reload */
    it("asks with the short-lived cache options", () => {
      usePublicEnv();

      expect(useQueryMock).toHaveBeenCalledWith({}, PUBLIC_ENV_QUERY_OPTIONS);
    });

    /** @scenario A provider the deployment stopped offering leaves the Connect offers on reload */
    it("keeps the answer for at most a minute and asks again on mount and on focus", () => {
      expect(Number.isFinite(PUBLIC_ENV_QUERY_OPTIONS.staleTime)).toBe(true);
      expect(PUBLIC_ENV_QUERY_OPTIONS.staleTime).toBeLessThanOrEqual(60_000);
      expect(PUBLIC_ENV_QUERY_OPTIONS.refetchOnMount).toBe(true);
      expect(PUBLIC_ENV_QUERY_OPTIONS.refetchOnWindowFocus).toBe(true);
    });
  });
});
