/**
 * @vitest-environment jsdom
 * Cloud staff are told when an organization's earlier single sign-on domain still has to move
 * onto its own connection. Corresponds to specs/identity/sso-idp-termination.feature.
 */
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import { OrganizationEditDrawer } from "../ui/sections/organizations-view.tsx";

const listState = vi.hoisted(() => ({ connections: [] as unknown[] }));

vi.mock("../behavior/use-admin-resource.ts", () => ({
  useAdminUpdate: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ssoConnections: {
      getAll: {
        useQuery: () => ({ data: { connections: listState.connections, total: 1 } }),
      },
    },
  },
}));

const organization = {
  id: "org-acme",
  name: "Acme",
  slug: "acme",
  phoneNumber: null,
  ssoDomain: "legacy.acme.com",
  ssoProvider: "okta",
  usageSpendingMaxLimit: null,
  datasetAttachmentMaxMb: null,
  signedDPA: false,
  promoCode: null,
  stripeCustomerId: null,
  currency: "USD" as const,
  pricingModel: "SEAT_EVENT" as const,
  useCustomS3: false,
  createdAt: "2026-04-01T10:00:00.000Z",
};

const ownConnection = {
  connectionId: "ssoc_direct",
  organizationId: "org-acme",
  source: "self-serve",
  state: "ACTIVE",
  verifiedDomains: ["acme.com"],
};

function openDrawer({ cloudOps }: { cloudOps: boolean }) {
  renderWithOpsHost(<OrganizationEditDrawer organization={organization} onClose={vi.fn()} />, {
    host: fakeOpsHost({ isOpsAdmin: true, cloudOps }),
  });
}

describe("Feature: Ops shows an organization's legacy single sign-on domain still to move", () => {
  beforeEach(() => {
    listState.connections = [ownConnection];
  });

  describe("given the legacy domain sits beside the organization's own connection", () => {
    it("tells cloud staff, with a link to the connection", () => {
      openDrawer({ cloudOps: true });

      const notice = screen.getByTestId("ops-legacy-sso-domain-to-move");
      expect(notice).toHaveTextContent(/legacy\.acme\.com still has to move/);
      expect(screen.getByRole("link", { name: /Open its connection/ })).toHaveAttribute(
        "href",
        "/ops/sso-connections?connection=ssoc_direct",
      );
    });

    it("says nothing off cloud, where the organization's administrators see it in settings", () => {
      openDrawer({ cloudOps: false });

      expect(screen.queryByTestId("ops-legacy-sso-domain-to-move")).toBeNull();
    });
  });

  describe("given the connection has verified the legacy domain", () => {
    it("says nothing", () => {
      listState.connections = [{ ...ownConnection, verifiedDomains: ["legacy.acme.com"] }];
      openDrawer({ cloudOps: true });

      expect(screen.queryByTestId("ops-legacy-sso-domain-to-move")).toBeNull();
    });
  });
});
