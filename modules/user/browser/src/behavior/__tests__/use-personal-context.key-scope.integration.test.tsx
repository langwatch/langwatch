/**
 * @vitest-environment jsdom
 * Personal-credentials card key scope: must name principal on /me (first-person
 * surface) to prevent admin from seeing other members' keys as their own.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { queryCalls, mockSession } = vi.hoisted(() => ({
  queryCalls: [] as {
    path: string;
    input: unknown;
    options: { enabled?: boolean } | undefined;
  }[],
  mockSession: {
    current: null as { id: string; email: string; name: string } | null,
  },
}));

/**
 * Records every `useQuery` the hook fires, keyed by procedure path, without
 * standing up a tRPC client. A proxy rather than a per-procedure mock so the
 * test keeps working when the hook grows another query.
 */
vi.mock("../personal-workspace-api.ts", () => {
  const procedure = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (input: unknown, options: { enabled?: boolean }) => {
              queryCalls.push({ path: path.join("."), input, options });
              return { data: undefined, isSuccess: false, isPending: true };
            };
          }
          return procedure([...path, property]);
        },
      },
    );
  return { api: procedure([]) };
});

vi.mock("../personal-workspace-session.ts", () => ({
  useCurrentUser: () => mockSession.current,
  useOrganizationTeamProject: () => ({
    organization: { id: "org_test", name: "Test org" },
  }),
}));

import { usePersonalContext } from "../use-personal-context.ts";

const listCall = () => queryCalls.find((call) => call.path === "personalVirtualKeys.list");

describe("given the personal-credentials card on /me", () => {
  afterEach(() => {
    queryCalls.length = 0;
    mockSession.current = null;
  });

  describe("when the signed-in user is known", () => {
    it("names the signed-in user as the principal the keys belong to", () => {
      mockSession.current = {
        id: "usr_signed_in",
        email: "signed-in@example.test",
        name: "Signed In",
      };

      renderHook(() => usePersonalContext());

      expect(listCall()?.input).toMatchObject({
        organizationId: "org_test",
        targetUserId: "usr_signed_in",
      });
    });
  });

  describe("when the session has not resolved yet", () => {
    it("withholds the request rather than asking with no principal", () => {
      mockSession.current = null;

      renderHook(() => usePersonalContext());

      // An enabled query with no `targetUserId` is exactly the org-wide
      // sweep this surface must never take, so an unresolved session has to
      // block the request instead of falling back to the server default.
      expect(listCall()?.options?.enabled).toBe(false);
    });

    it("still names a target, so a flipped gate could not fall into the sweep", () => {
      mockSession.current = null;

      renderHook(() => usePersonalContext());

      // Belt and braces for the assertion above. `undefined` is the literal
      // value that means "sweep the org", so the input must not carry it
      // even while the request is withheld — otherwise the guarantee rests
      // on `enabled` alone and one refactor reopens the hole.
      expect(listCall()?.input).toMatchObject({ targetUserId: "" });
    });
  });
});
