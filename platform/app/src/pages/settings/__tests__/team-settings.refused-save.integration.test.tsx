/**
 * @vitest-environment jsdom
 *
 * Team settings autosaves on a debounce, and it moves its local baseline to the
 * submitted values before the mutation answers. That baseline is what the next
 * autosave diffs against and resubmits, so when the server refuses a save the
 * baseline decides whether the page recovers or stays wedged: a refused member
 * list left in place is resent with every later edit, and the server refuses
 * that too, which is how a rename stops working after an unrelated refusal.
 *
 * The personal-workspace guards make refusals routine here, so this drives the
 * real page over a real react-hook-form and only stands in for the network,
 * the router and the form's chakra view.
 *
 * Spec: platform/app/specs/licensing/enforcement-resources.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import type { ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamFormData } from "~/components/settings/TeamForm";

const OWNER = { id: "user-owner", name: "Jane", email: "jane@acme.test" };
const SECOND = { id: "user-second", name: "Sam", email: "sam@acme.test" };

const { mockUpdateMutate, mockArchiveMutate, mockToasterCreate } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
  mockArchiveMutate: vi.fn(),
  mockToasterCreate: vi.fn(),
}));

function buildTeam() {
  return {
    id: "team-personal",
    name: "Jane's workspace",
    slug: "janes-workspace",
    organizationId: "org-acme",
    projects: [],
    members: [
      {
        userId: OWNER.id,
        role: "ADMIN",
        assignedRole: null,
        user: OWNER,
      },
    ],
  };
}

vi.mock("~/utils/api", () => ({
  api: {
    team: {
      getTeamWithMembers: {
        useQuery: () => ({
          data: buildTeam(),
          isLoading: false,
          error: null,
        }),
      },
      update: {
        useMutation: () => ({ mutate: mockUpdateMutate, isLoading: false }),
      },
      archiveById: {
        useMutation: () => ({ mutate: mockArchiveMutate, isLoading: false }),
      },
    },
    useUtils: () => ({
      organization: { getAll: { refetch: vi.fn() } },
    }),
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-acme", name: "ACME" },
    project: undefined,
    hasOrgPermission: () => true,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: { team: "janes-workspace" }, push: vi.fn() }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: React.ComponentType<P>) =>
      Component,
}));

vi.mock("~/components/gateway/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToasterCreate },
}));

/**
 * Stands in for the chakra form so the test can drive the two edits that
 * matter, and read back what the form currently holds, without going through
 * selects and field arrays. The form object is the real one the page built.
 */
vi.mock("~/components/settings/TeamForm", () => ({
  TeamForm: ({
    form,
    onSubmit,
  }: {
    form: UseFormReturn<TeamFormData, any, TeamFormData>;
    onSubmit: (data: TeamFormData) => void;
  }) => {
    const members = form.watch("members");
    return (
      <div>
        <div data-testid="member-ids">
          {members.map((member) => member.userId?.value ?? "").join(",")}
        </div>
        <input data-testid="team-name" {...form.register("name")} />
        <button
          type="button"
          data-testid="add-member"
          onClick={() => {
            form.setValue("members", [
              ...form.getValues("members"),
              {
                userId: { label: SECOND.name, value: SECOND.id },
                role: { label: "Admin", value: "ADMIN" },
                saved: false,
              } as TeamFormData["members"][number],
            ]);
            void form.handleSubmit(onSubmit)();
          }}
        >
          add member
        </button>
      </div>
    );
  },
}));

import EditTeamPage from "~/pages/settings/teams/[team]";

/** The refusal the personal-workspace guards raise on this mutation. */
function personalWorkspaceRefusal(): TRPCClientError<never> {
  const error = new TRPCClientError<never>(
    "A personal workspace holds only its owner. Create a shared team to work with other people.",
  );
  (error as unknown as { data: unknown }).data = { code: "FORBIDDEN" };
  return error;
}

/** Answers the most recent update call the way the server would. */
function refuseLatestSave(): void {
  const call = mockUpdateMutate.mock.calls.at(-1);
  const options = call?.[1] as { onError?: (error: unknown) => void };
  options?.onError?.(personalWorkspaceRefusal());
}

function membersOfLatestSave(): string[] {
  const call = mockUpdateMutate.mock.calls.at(-1);
  const variables = call?.[0] as { members: { userId: string }[] };
  return variables.members.map((member) => member.userId);
}

function renderTeamSettings() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EditTeamPage />
    </ChakraProvider>,
  );
}

describe("Team settings autosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a save the server refuses", () => {
    describe("when the refusal comes back", () => {
      it("puts the member list back to what the server holds", async () => {
        const { getByTestId } = renderTeamSettings();
        expect(getByTestId("member-ids").textContent).toBe(OWNER.id);

        fireEvent.click(getByTestId("add-member"));
        await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalled());
        expect(membersOfLatestSave()).toEqual([OWNER.id, SECOND.id]);

        refuseLatestSave();

        await waitFor(() => expect(getByTestId("member-ids").textContent).toBe(OWNER.id));
      });

      it("surfaces the server's sentence rather than saving silently", async () => {
        const { getByTestId } = renderTeamSettings();

        fireEvent.click(getByTestId("add-member"));
        await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalled());
        refuseLatestSave();

        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title:
              "A personal workspace holds only its owner. Create a shared team to work with other people.",
            type: "error",
          }),
        );
      });
    });

    describe("when the next edit is saved", () => {
      it("sends the members the server holds, so a rename can still land", async () => {
        const { getByTestId } = renderTeamSettings();

        fireEvent.click(getByTestId("add-member"));
        await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalled());
        refuseLatestSave();
        await waitFor(() => expect(getByTestId("member-ids").textContent).toBe(OWNER.id));

        const callsBeforeRename = mockUpdateMutate.mock.calls.length;
        fireEvent.change(getByTestId("team-name"), {
          target: { value: "Renamed workspace" },
        });

        await waitFor(() =>
          expect(mockUpdateMutate.mock.calls.length).toBeGreaterThan(callsBeforeRename),
        );
        // The refused member never rides along, which is what kept the rename
        // from ever being accepted.
        expect(membersOfLatestSave()).toEqual([OWNER.id]);
      });
    });
  });
});
