/**
 * @vitest-environment jsdom
 * Who the upgrade button invites. @see specs/licensing/subscription-permissions.feature
 */
import type { StripeEnvironment } from "@langwatch/enterprise-billing-contract";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BillingHostOrganization,
  BillingHostApi,
  BillingHostProvider,
} from "../../../model/billing-host.ts";
import { useSubscriptionActions } from "../use-subscription-actions.ts";

const createSubscription = vi.fn(async (_input: unknown) => ({ url: "https://checkout" }));
const upgradeWithInvites = vi.fn(async (_input: unknown) => ({ url: "https://checkout" }));

vi.mock("@langwatch/browser-host/lent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLentHooks: () => ({ openSeats: vi.fn() }),
}));

vi.mock("../../../behavior/billing-api.ts", () => ({
  billingApi: {
    subscription: {
      create: { useMutation: () => ({ mutateAsync: createSubscription, isPending: false }) },
      addTeamMemberOrEvents: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      manage: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    invite: {
      upgradeWithInvites: {
        useMutation: () => ({ mutateAsync: upgradeWithInvites, isPending: false }),
      },
    },
  },
}));

class MemberHost extends BillingHostApi {
  readonly departures: string[] = [];

  constructor(private readonly mayInvite: boolean) {
    super();
  }

  organization(): BillingHostOrganization | undefined {
    return { id: "org-1", name: "Acme", pricingModel: null };
  }
  activeTeamId(): string | undefined {
    return void 0;
  }
  canInviteMembers(): boolean {
    return this.mayInvite;
  }
  routeQuery(): Readonly<Record<string, string | undefined>> {
    return {};
  }
  isSaaS(): boolean {
    return true;
  }
  stripeEnvironment(): StripeEnvironment {
    return "test";
  }
  isDeploymentSettled(): boolean {
    return true;
  }
  navigate(): void {}
  replace(): void {}
  leaveTo(url: string): void {
    this.departures.push(url);
  }
  applicationOrigin(): string {
    return "http://localhost";
  }
  succeeded(): void {}
  failed(): void {}
}

function upgradeAs(host: MemberHost) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BillingHostProvider value={host}>{children}</BillingHostProvider>
  );
  return renderHook(
    () =>
      useSubscriptionActions({
        organizationId: "org-1",
        currency: "EUR",
        billingPeriod: "monthly",
        totalFullMembers: 3,
        plannedUsers: [
          { id: "p1", email: "finance@acme.test", memberType: "FullMember" },
          { id: "p2", email: "ops@acme.test", memberType: "FullMember" },
        ],
        onSeatsUpdated: vi.fn(),
        organizationWithMembers: { refetch: vi.fn() },
      }),
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given planned seats with email addresses", () => {
  describe("when a member who may not invite presses upgrade", () => {
    /** @scenario "A member who may not invite buys the planned seats without sending invitations" */
    it("checks out the planned seat count and sends no invitation", async () => {
      const host = new MemberHost(false);
      const { result } = upgradeAs(host);

      await act(() => result.current.handleUpgrade());

      expect(upgradeWithInvites).not.toHaveBeenCalled();
      expect(createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1", membersToAdd: 3 }),
      );
      expect(host.departures).toEqual(["https://checkout"]);
    });
  });

  describe("when an administrator presses upgrade", () => {
    it("sends the invitations with the checkout", async () => {
      const { result } = upgradeAs(new MemberHost(true));

      await act(() => result.current.handleUpgrade());

      expect(createSubscription).not.toHaveBeenCalled();
      expect(upgradeWithInvites).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSeats: 3,
          invites: [
            { email: "finance@acme.test", role: "MEMBER" },
            { email: "ops@acme.test", role: "MEMBER" },
          ],
        }),
      );
    });
  });
});
