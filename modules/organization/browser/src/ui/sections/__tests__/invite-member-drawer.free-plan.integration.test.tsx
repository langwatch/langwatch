/**
 * @vitest-environment jsdom
 * On Free there are no Lite seats: the invite drawer says so in place and offers Billing only
 * for whoever pays.
 * @see specs/licensing/billing-only-invite.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";
import { InviteMemberDrawer } from "../invite-member-drawer.tsx";

const calls = vi.hoisted(() => ({ createInvites: vi.fn() }));

vi.mock("../../../behavior/organization-api.ts", () => {
  const answers: Record<string, unknown> = {
    "plan.getActivePlan": {
      type: "FREE",
      free: true,
      planSource: "free",
      maxMembers: 2,
      maxMembersLite: 0,
    },
    "licenseEnforcement.checkLimit": { allowed: false, current: 2, max: 2 },
  };

  const endpoint = (path: string) => ({
    useQuery: () => ({ data: answers[path] ?? [], isLoading: false, refetch: vi.fn() }),
    useMutation: () => ({
      mutate: (input: unknown, handlers?: { onSuccess?: (data: unknown) => void }) => {
        if (path === "invite.createInvites") {
          calls.createInvites(input);
          handlers?.onSuccess?.([
            { invite: { inviteCode: "code-1", email: "lena@acme.com" }, emailNotSent: false },
          ]);
          return;
        }
        handlers?.onSuccess?.(void 0);
      },
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

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

vi.mock("../../../behavior/use-growth-seat-price.ts", () => ({
  useGrowthSeatPrice: () => "$32",
}));

let host: FakeOrganizationHost;

async function openSeatList() {
  await userEvent.click(screen.getByTestId("members-role-select"));
}

async function pickLite() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Seat" }));
  await user.click(await screen.findByRole("option", { name: /Lite Member/ }));
}

beforeEach(async () => {
  host = new FakeOrganizationHost({ grants: new Set(["organization:manage"]) });
  renderWithOrganizationHost(<InviteMemberDrawer open={true} />, host);
  await userEvent.type(
    screen.getByPlaceholderText("alice@example.com, bob@example.com"),
    "lena@acme.com ",
  );
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("the invite drawer on Free", () => {
  describe("when the admin opens the seat list", () => {
    /** @scenario "On Free the invite seat list says what each seat costs there" */
    it("says what each seat is on Free", async () => {
      await openSeatList();

      expect(
        within(await screen.findByTestId("members-role-option-MEMBER")).getByText(
          "2 of 2 used on Free",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("members-role-option-EXTERNAL")).getByText("Not on Free"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("members-role-option-BILLING_ONLY")).getByText(
          "Pays for LangWatch: plan, invoices, upgrade",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when the admin picks Lite Member", () => {
    /** @scenario "Picking Lite on Free offers Billing only in place" */
    it("offers Billing only in place and holds the send button", async () => {
      await pickLite();

      const notice = await screen.findByTestId("invite-lite-not-on-free");
      expect(notice).toHaveTextContent("Free has no Lite seats");
      expect(notice).toHaveTextContent(
        "If lena@acme.com pays for LangWatch, invite them as Billing only. It takes no seat, shows the plan and invoices, and lets them upgrade Acme.",
      );
      expect(notice).toHaveTextContent(
        "Growth has unlimited Lite members, from $32/mo per full seat.",
      );
      expect(within(notice).getByRole("button", { name: "Upgrade to Growth" })).toBeVisible();
      expect(screen.getByTestId("members-invite-submit")).toBeDisabled();
    });

    /** @scenario "Invite as Billing only sends the invite from the Free notice" */
    it("sends a Billing only invite and names the person in the toast", async () => {
      await pickLite();
      await userEvent.click(await screen.findByTestId("invite-as-billing-only"));

      await waitFor(() => expect(calls.createInvites).toHaveBeenCalled());
      expect(calls.createInvites.mock.calls[0]?.[0]).toMatchObject({
        invites: [{ email: "lena@acme.com", role: "EXTERNAL", teams: [], billingOnly: true }],
      });
      await waitFor(() =>
        expect(JSON.stringify(host.successes)).toContain(
          "lena@acme.com was invited as Billing only",
        ),
      );
    });

    /** @scenario "Upgrade to Growth from the Free notice opens the plan page" */
    it("closes the drawer and opens the plan page on Upgrade to Growth", async () => {
      await pickLite();
      await userEvent.click(await screen.findByRole("button", { name: "Upgrade to Growth" }));

      expect(host.overlays).toContainEqual({ name: null });
      expect(host.navigations).toContain("/settings/subscription");
    });
  });
});
