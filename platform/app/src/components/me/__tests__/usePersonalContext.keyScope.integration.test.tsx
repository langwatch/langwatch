/**
 * @vitest-environment jsdom
 *
 * Whose keys the personal-credentials card asks for.
 *
 * `personalVirtualKeys.list` widens with the caller: omitting `targetUserId`
 * means "every personal key in this organization" for anyone holding
 * `virtualKeys:viewOtherPersonal`, which the org ADMIN role template grants.
 * That mode exists for the off-boarding sweep and is correct where it is
 * used. It is wrong on /me, which is a first-person surface — an admin was
 * shown other members' keys as their own, and revoking one then failed
 * because `revokePersonal` scopes to the caller.
 *
 * The scope therefore cannot be left to the server's default here: the hook
 * has to name the principal, and it has to withhold the request until it
 * knows who that is.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { queryCalls, mockSession } = vi.hoisted(() => ({
  queryCalls: [] as Array<{
    path: string;
    input: unknown;
    options: { enabled?: boolean } | undefined;
  }>,
  mockSession: {
    current: null as { user: { id: string } } | null,
  },
}));

/**
 * Records every `useQuery` the hook fires, keyed by procedure path, without
 * standing up a tRPC client. A proxy rather than a per-procedure mock so the
 * test keeps working when the hook grows another query.
 */
vi.mock("~/utils/api", () => {
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

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: mockSession.current }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_test", name: "Test org" },
  }),
}));

vi.mock("../../useWorkspaceData", () => ({
  useWorkspaceData: () => ({
    personals: [],
    teams: [],
    projects: [],
    onCreateProjectForTeam: () => undefined,
  }),
}));

import { usePersonalContext } from "../usePersonalContext";

const listCall = () =>
  queryCalls.find((call) => call.path === "personalVirtualKeys.list");

describe("given the personal-credentials card on /me", () => {
  afterEach(() => {
    queryCalls.length = 0;
    mockSession.current = null;
  });

  describe("when the signed-in user is known", () => {
    it("names the signed-in user as the principal the keys belong to", () => {
      mockSession.current = { user: { id: "usr_signed_in" } };

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
