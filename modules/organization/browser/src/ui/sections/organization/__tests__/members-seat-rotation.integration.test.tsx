/**
 * @vitest-environment jsdom
 * The remove dialog says what happens to the seat, and held seats stay listed until they free.
 * @see specs/licensing/seat-rotation.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import MembersScreen from "../members.screen.tsx";

const state = vi.hoisted(() => ({
  members: [] as unknown[],
  heldSeats: [] as unknown[],
  preview: null as unknown,
  previewFails: false,
  removals: [] as unknown[],
}));

vi.mock("../../../../behavior/organization-api.ts", () => {
  const answers = (path: string): unknown => {
    if (path === "organization.getOrganizationWithMembersAndTheirTeams") {
      return { id: "org-1", name: "ACME", members: state.members, teams: [] };
    }
    if (path === "organization.listHeldSeats") return { heldSeats: state.heldSeats };
    if (path === "organization.getSeatRemovalPreview") return state.preview;
    if (path === "plan.getActivePlan") return { type: "GROWTH", free: false, maxMembers: 5 };
    return [];
  };

  const endpoint = (path: string) => ({
    useQuery: () => {
      if (path === "organization.getSeatRemovalPreview" && state.previewFails) {
        return { data: undefined, isSuccess: false, isError: true, error: new Error("boom") };
      }
      const data = answers(path);
      return { data, isSuccess: data !== null, isError: false, error: null, refetch: vi.fn() };
    },
    useMutation: () => ({
      mutate: (input: unknown) => state.removals.push({ path, input }),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
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
  useMemberProvenance: () => ({ data: {}, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../../../../behavior/use-join-requests.ts", () => ({
  useJoinRequests: () => ({
    requests: [],
    answeringId: null,
    approve: vi.fn(),
    reject: vi.fn(),
    automaticJoins: [],
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
  useRequiredSession: () => ({ data: { user: { id: "user_foo" } } }),
}));
// Seat usage has its own suite; here it only stays out of the way.
vi.mock("../../member-seat-usage.tsx", () => ({
  MemberSeatUsage: () => <div data-testid="seat-usage">Seats</div>,
}));
vi.mock("../../../../behavior/use-department-column.ts", () => ({
  useDepartmentColumn: () => ({
    show: false,
    byUser: new Map(),
    byTeam: new Map(),
    byProject: new Map(),
    departments: [],
    refetch: vi.fn(),
  }),
}));

const person = (userId: string, name: string, role: string) => ({
  userId,
  role,
  disabledAt: null,
  user: {
    id: userId,
    name,
    email: `${name.toLowerCase()}@acme.com`,
    image: null,
    deactivatedAt: null,
  },
});

const renderUsers = () =>
  renderWithOrganizationHost(
    <MembersScreen />,
    new FakeOrganizationHost({ grants: new Set(["organization:manage"]) }),
  );

/** Opens the remove dialog for one member from their row menu. */
async function openRemoveDialogFor(name: string) {
  renderUsers();
  await userEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await userEvent.click(await screen.findByTestId("members-row-delete"));
  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  state.members = [person("user_foo", "Foo", "ADMIN"), person("user_bar", "Bar", "MEMBER")];
  state.heldSeats = [];
  state.preview = null;
  state.previewFails = false;
  state.removals = [];
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("given Bar took their seat 45 days ago and Qux waits for a seat", () => {
  beforeEach(() => {
    state.preview = {
      holdsFullSeat: true,
      seatFreesAt: null,
      waiting: { userId: "user_qux", name: "Qux", email: "qux@acme.com" },
    };
  });

  describe("when an administrator opens the remove dialog for Bar", () => {
    /** @scenario "Removing a long-held seat with someone waiting" */
    it("says the seat frees now and offers it to Qux, ticked", async () => {
      const dialog = await openRemoveDialogFor("Bar");

      expect(within(dialog).getByText("Remove Bar from ACME?")).toBeInTheDocument();
      expect(within(dialog).getByText("Their seat frees up right away.")).toBeInTheDocument();
      const offer = within(dialog).getByTestId("remove-member-give-seat");
      expect(offer).toHaveTextContent("Qux is waiting for a seat. Give them this seat?");
      expect(within(offer).getByRole("checkbox")).toBeChecked();
      expect(
        within(dialog).getByRole("button", { name: "Remove and give the seat to Qux" }),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    /** @scenario "Removing a long-held seat with someone waiting" */
    it("gives the seat to Qux on confirm", async () => {
      const dialog = await openRemoveDialogFor("Bar");

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Remove and give the seat to Qux" }),
      );

      expect(state.removals).toContainEqual({
        path: "organization.deleteMember",
        input: { organizationId: "org-1", userId: "user_bar", giveSeatToUserId: "user_qux" },
      });
    });

    /** @scenario "The removal can leave the freed seat empty" */
    it("removes without giving the seat away once the box is unticked", async () => {
      const dialog = await openRemoveDialogFor("Bar");

      await userEvent.click(within(dialog).getByText("Give them this seat?"));
      await userEvent.click(await within(dialog).findByRole("button", { name: "Remove" }));

      expect(state.removals).toContainEqual({
        path: "organization.deleteMember",
        input: { organizationId: "org-1", userId: "user_bar", giveSeatToUserId: null },
      });
    });
  });
});

describe("given Bar took their seat on 3 November", () => {
  beforeEach(() => {
    state.preview = {
      holdsFullSeat: true,
      seatFreesAt: "2026-12-03T12:00:00.000Z",
      waiting: { userId: "user_qux", name: "Qux", email: "qux@acme.com" },
    };
  });

  describe("when an administrator opens the remove dialog for Bar", () => {
    /** @scenario "Removing a recent seat" */
    it("says the seat stays taken until 3 Dec, offers nothing, and reads Remove", async () => {
      const dialog = await openRemoveDialogFor("Bar");

      expect(
        within(dialog).getByText(
          "They lose access now. Their seat stays taken until 3 Dec, 30 days after they joined.",
        ),
      ).toBeInTheDocument();
      expect(within(dialog).queryByTestId("remove-member-give-seat")).toBeNull();
      expect(within(dialog).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    });
  });
});

describe("given the seat preview cannot be read", () => {
  beforeEach(() => {
    state.previewFails = true;
  });

  it("still confirms a plain removal", async () => {
    const dialog = await openRemoveDialogFor("Bar");

    expect(within(dialog).getByText("They lose access to everything in it.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(state.removals).toContainEqual({
        path: "organization.deleteMember",
        input: { organizationId: "org-1", userId: "user_bar", giveSeatToUserId: null },
      }),
    );
  });
});

describe("given Bar was removed with a seat held until 3 December", () => {
  beforeEach(() => {
    state.members = [person("user_foo", "Foo", "ADMIN"), person("user_baz", "Baz", "MEMBER")];
    state.heldSeats = [
      {
        userId: "user_bar",
        name: "Bar",
        email: "bar@acme.com",
        seatTakenAt: "2026-11-03T12:00:00.000Z",
        seatFreesAt: "2026-12-03T12:00:00.000Z",
        reason: "REMOVED",
      },
    ];
  });

  describe("when an administrator opens Users", () => {
    /** @scenario "A removed person with a held seat is listed as Deactivated" */
    it("lists Bar greyed out after the members, with the day the seat frees", () => {
      renderUsers();

      const list = screen.getByTestId("people-list");
      const names = within(list)
        .getAllByTestId(/^(member-row|held-seat-row)$/)
        .map((row) => row.getAttribute("data-testid"));
      expect(names).toEqual(["member-row", "member-row", "held-seat-row"]);

      const held = screen.getByTestId("held-seat-row");
      expect(within(held).getByText("Bar")).toBeInTheDocument();
      expect(within(held).getByText("bar@acme.com")).toBeInTheDocument();
      expect(within(held).getByTestId("held-seat-chip")).toHaveTextContent(
        "Deactivated, seat frees 3 Dec",
      );
      expect(held).toHaveStyle({ opacity: "0.6" });
    });

    /** @scenario "A removed person with a held seat is listed as Deactivated" */
    it("offers no actions on Bar", () => {
      renderUsers();

      const held = screen.getByTestId("held-seat-row");
      expect(within(held).queryByRole("button")).toBeNull();
    });
  });
});
