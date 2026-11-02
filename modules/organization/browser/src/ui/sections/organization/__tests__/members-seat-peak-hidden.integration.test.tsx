/**
 * @vitest-environment jsdom
 * The month's seat peak is our team's, for renewal (ADR-002): the customer's members page shows
 * the seats in use and never asks for the peak.
 * @see modules/organization/specs/seat-peak.feature
 */
import "@testing-library/jest-dom/vitest";
import { uiDeclarations } from "@langwatch/browser-host/declarations";
import {
  type ResourceLimitRowProps,
  ResourceLimitRowToken,
} from "@langwatch/enterprise-licensing-client";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import MembersScreen from "../members.screen.tsx";

const state = vi.hoisted(() => ({
  asked: new Set<string>(),
  provenance: {} as Record<string, unknown>,
  provenanceFails: false,
  requests: [] as unknown[],
  departments: {
    show: false,
    departments: [] as { id: string; name: string }[],
    byUser: new Map<string, string>(),
  },
}));

// The row is licensing's to draw; here it only shows the numbers organization hands it.
const LentRow = ({ limitType, label, current, max }: ResourceLimitRowProps) => (
  <p>{`${limitType ?? label}: ${current} / ${max ?? "none"}`}</p>
);
vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () =>
    uiDeclarations([
      {
        name: "licensing",
        installation: {
          capabilities: {},
          lends: [{ token: ResourceLimitRowToken, load: async () => ({ default: LentRow }) }],
        },
      },
    ]),
}));

vi.mock("../../../../behavior/organization-api.ts", () => {
  const person = (userId: string, name: string) => ({
    userId,
    role: "MEMBER",
    disabledAt: null,
    user: { id: userId, name, email: `${userId}@acme.com`, image: null, deactivatedAt: null },
  });
  const answers = (path: string): unknown => {
    if (path === "organization.getOrganizationWithMembersAndTheirTeams") {
      return { id: "org-1", name: "Acme", members: [person("user_sam", "Sam Rivera")], teams: [] };
    }
    if (path === "limits.getUsage") {
      return { membersCount: 12, membersLiteCount: 1, membersDeveloperCount: 0 };
    }
    if (path === "plan.getActivePlan") {
      return { type: "ENTERPRISE", free: false, maxMembers: 15, maxMembersLite: 3 };
    }
    return [];
  };

  const endpoint = (path: string) => ({
    useQuery: () => {
      state.asked.add(path);
      return { data: answers(path), isError: false, error: null, refetch: vi.fn() };
    },
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

vi.mock("../../../../behavior/use-member-provenance.ts", () => ({
  useMemberProvenance: () =>
    state.provenanceFails
      ? { data: undefined, isError: true, error: new Error("boom"), refetch: vi.fn() }
      : { data: state.provenance, isError: false, error: null, refetch: vi.fn() },
}));

vi.mock("../../../../behavior/use-join-requests.ts", () => ({
  useJoinRequests: () => ({
    requests: state.requests,
    answeringId: null,
    approve: vi.fn(),
    reject: vi.fn(),
    automaticJoins: [],
    joining: { domainJoin: "off", joinDomains: [], joinerRole: "MEMBER" },
    savingJoining: false,
    setJoining: vi.fn(),
  }),
}));

vi.mock("../../../../behavior/user/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) => image ?? null,
}));

vi.mock("../../../../behavior/use-two-step-requirement.ts", () => ({
  useTwoStepRequirement: () => ({ show: false, mfaRequired: false, byUser: new Map() }),
}));

vi.mock("../../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

vi.mock("../../../../behavior/use-required-session.ts", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user_ana" } } }),
}));

vi.mock("../../department-picker.tsx", () => ({
  DepartmentPicker: () => <div data-testid="department-picker" />,
}));
vi.mock("../../../../behavior/use-department-column.ts", () => ({
  useDepartmentColumn: () => ({
    show: state.departments.show,
    byUser: state.departments.byUser,
    byTeam: new Map(),
    byProject: new Map(),
    departments: state.departments.departments,
    refetch: vi.fn(),
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  state.asked.clear();
});

describe("given an organization that held more seats at once this month than it holds now", () => {
  describe("when an admin of the organization opens its members page", () => {
    /** @scenario "The customer's own pages do not show the peak" */
    it("shows the seats in use and neither asks for nor shows the month's peak", async () => {
      renderWithOrganizationHost(
        <MembersScreen />,
        new FakeOrganizationHost({ grants: new Set(["organization:manage"]) }),
      );

      expect(await screen.findByText("members: 12 / 15")).toBeInTheDocument();
      expect(screen.queryByText(/peak/i)).not.toBeInTheDocument();
      expect([...state.asked].filter((path) => /seatpeak/i.test(path))).toEqual([]);
    });
  });
});
