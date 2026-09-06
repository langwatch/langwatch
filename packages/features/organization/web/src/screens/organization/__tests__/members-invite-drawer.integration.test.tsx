/**
 * @vitest-environment jsdom
 * Adding a teammate is one reachable action from the members page: the header
 * button opens the invite drawer, and the inline box opens it already carrying
 * what was typed.
 * @see specs/settings/add-member-drawer.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing";
import MembersScreen from "../members.screen";

vi.mock("../../../behavior/organization-api", () => {
  /**
   * Every read this screen makes, answered empty. The screen reads six
   * endpoints on the way to rendering its header, and none of them is what
   * these scenarios are about — the two ways the invite drawer opens are.
   */
  const answers: Record<string, unknown> = {
    "organization.getOrganizationWithMembersAndTheirTeams": {
      id: "org-1",
      name: "Acme",
      members: [],
      teams: [{ id: "team-1", name: "Engineering", slug: "engineering", members: [] }],
    },
    "plan.getActivePlan": { type: "ENTERPRISE", free: false, maxMembers: 100 },
    "departments.assignments": { users: [], teams: [], projects: [] },
    "limits.getUsage": { membersCount: 1, membersLiteCount: 0 },
  };

  const endpoint = (path: string) => ({
    useQuery: () => ({ data: answers[path] ?? [], isLoading: false, refetch: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    invalidate: vi.fn(),
    fetch: vi.fn(),
  });

  const namespace = (prefix: string): Record<string, unknown> =>
    new Proxy(endpoint(prefix) as Record<string, unknown>, {
      get: (target: Record<string, unknown>, name) => {
        if (name in target) return target[name as string];
        if (typeof name !== "string") return void 0;
        return namespace(prefix ? `${prefix}.${name}` : name);
      },
    }) as Record<string, unknown>;

  const root = namespace("");
  root.useUtils = () => root;
  return { api: root };
});

vi.mock("../../../behavior/use-join-requests", () => ({
  useJoinRequests: () => ({
    requests: [],
    isLoading: false,
    joining: { domainJoin: "request", joinDomains: [] },
    savingJoining: false,
    setJoining: vi.fn(),
    decide: vi.fn(),
  }),
}));

vi.mock("../../../behavior/use-public-env", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

vi.mock("../../../behavior/use-required-session", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

const renderMembers = () => {
  const host = new FakeOrganizationHost({ grants: new Set(["organization:manage"]) });
  return renderWithOrganizationHost(<MembersScreen />, host);
};

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("the organization members page", () => {
  describe("given an admin is looking at it", () => {
    /** @scenario The members page opens the invite drawer */
    it("opens the invite drawer from Add members", async () => {
      const { host } = renderMembers();

      await userEvent.click(screen.getByRole("button", { name: /add members/i }));

      expect(host.overlays).toEqual([{ name: "inviteMember", props: undefined }]);
    });

    /** @scenario Typing an email inline opens the drawer carrying that email */
    it("opens the drawer carrying what was typed into the inline box", async () => {
      const { host } = renderMembers();

      await userEvent.type(screen.getByLabelText("Invite a teammate by email"), "n");

      expect(host.overlays[0]).toEqual({
        name: "inviteMember",
        props: { initialEmail: "n" },
      });
    });
  });
});
