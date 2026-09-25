/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { MemberSeatUsage } from "../../components/settings/MemberSeatUsage";
import { useInviteActions } from "../useInviteActions";

type Scope = { organizationId: string };
type Usage = { membersCount: number; membersLiteCount: number };
const { readUsage, createInvite, revokeInvite, resendInvite, showErrorToast } =
  vi.hoisted(() => ({
    readUsage: vi.fn<(scope: Scope) => Promise<Usage>>(),
    createInvite: vi.fn<() => Promise<unknown>>(),
    revokeInvite: vi.fn<() => Promise<void>>(),
    resendInvite: vi.fn<() => Promise<unknown>>(),
    showErrorToast: vi.fn(),
  }));

vi.mock("~/features/errors", () => ({ showErrorToast }));
vi.mock("../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));
vi.mock("../useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (allowed: () => void) => allowed(),
  }),
}));
vi.mock("../../utils/api", async () => {
  const query = await import("@tanstack/react-query");
  const { useQuery, useMutation, useQueryClient } = query;
  return {
    api: {
      limits: {
        getUsage: {
          useQuery: (scope: Scope) =>
            useQuery({
              queryKey: ["usage", scope.organizationId],
              queryFn: () => readUsage(scope),
            }),
        },
      },
      invite: {
        createInvites: {
          useMutation: () => useMutation({ mutationFn: createInvite }),
        },
        deleteInvite: {
          useMutation: () => useMutation({ mutationFn: revokeInvite }),
        },
        resendInvite: {
          useMutation: () => useMutation({ mutationFn: resendInvite }),
        },
      },
      useUtils: () => {
        const client = useQueryClient();
        return {
          limits: {
            getUsage: {
              invalidate: (scope?: Scope) =>
                client.invalidateQueries({
                  queryKey: scope ? ["usage", scope.organizationId] : ["usage"],
                }),
            },
          },
          licenseEnforcement: {
            checkLimit: { invalidate: () => Promise.resolve() },
          },
        };
      },
    },
  };
});

const plan: PlanInfo = {
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMembers: 600,
  maxMembersLite: 600,
  maxMessagesPerMonth: 1000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};
const invite = {
  invite: { inviteCode: "fixture-invitation", email: "member@acme.test" },
  emailNotSent: false,
};

function InviteControls() {
  const actions = useInviteActions({
    organizationId: "org_acme",
    hasEmailProvider: true,
    onInviteCreated: vi.fn(),
    onClose: vi.fn(),
    refetchInvites: vi.fn(),
    activePlanFree: false,
    activePlanType: "ENTERPRISE",
    activePlanSource: "license",
  });
  return (
    <>
      <button
        type="button"
        onClick={() =>
          actions.onSubmit({
            invites: [
              { email: "member@acme.test", orgRole: "EXTERNAL", teams: [] },
            ],
          })
        }
      >
        Create
      </button>
      <button type="button" onClick={() => actions.revokeInvite("invite_acme")}>
        Revoke
      </button>
      <button type="button" onClick={() => actions.resendInvite("invite_acme")}>
        Resend
      </button>
      <section aria-label="Acme seats">
        <MemberSeatUsage organizationId="org_acme" activePlan={plan} />
      </section>
      <section aria-label="Other organization seats">
        <MemberSeatUsage organizationId="org_other" activePlan={plan} />
      </section>
    </>
  );
}

const clients: QueryClient[] = [];
function renderInvites() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ChakraProvider value={defaultSystem}>
        <InviteControls />
      </ChakraProvider>
    </QueryClientProvider>,
  );
  return within(screen.getByRole("region", { name: "Acme seats" }));
}

describe("when invitations change reserved seats in an open directory", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    for (const client of clients.splice(0)) client.clear();
  });

  for (const change of [
    { action: "Create", before: 0, after: 1 },
    { action: "Revoke", before: 1, after: 0 },
    { action: "Resend", before: 0, after: 1 },
  ]) {
    /** @scenario Invitation changes refresh the visible seat usage */
    it(`${change.action} refreshes the affected organization's visible seats`, async () => {
      let reserved = change.before;
      readUsage.mockImplementation(async ({ organizationId }) => ({
        membersCount: 2,
        membersLiteCount: organizationId === "org_acme" ? reserved : 7,
      }));
      createInvite.mockImplementation(async () => {
        reserved = change.after;
        return [invite];
      });
      revokeInvite.mockImplementation(async () => {
        reserved = change.after;
      });
      resendInvite.mockImplementation(async () => {
        reserved = change.after;
        return invite;
      });
      const seats = renderInvites();
      expect(await seats.findByText(String(change.before))).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: change.action }));

      expect(await seats.findByText(String(change.after))).toBeInTheDocument();
      expect(
        readUsage.mock.calls.filter(
          ([scope]) => scope.organizationId === "org_other",
        ),
      ).toHaveLength(1);
    });
  }

  it("keeps the reserved seat when revocation is refused", async () => {
    readUsage.mockResolvedValue({ membersCount: 2, membersLiteCount: 1 });
    revokeInvite.mockRejectedValue(new Error("Revocation refused"));
    const seats = renderInvites();
    expect(await seats.findByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledOnce());
    expect(seats.getByText("1")).toBeInTheDocument();
    expect(seats.queryByText("0")).not.toBeInTheDocument();
  });
});
