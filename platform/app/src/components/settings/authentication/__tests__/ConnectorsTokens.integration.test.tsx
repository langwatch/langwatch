/**
 * @vitest-environment jsdom
 *
 * Issuing a provisioning token, and which connections may carry one
 * (specs/identity/org-access-cluster.feature).
 *
 * A token is bound to one connection and can only touch the people that
 * connection provisioned. Bound to one that does not route it authenticates
 * perfectly and provisions nobody, so the dialog offers only the live ones —
 * while the table beside it keeps naming every connection a token was ever
 * issued against, retired or not, because that is the row whose name a reader
 * has come to check.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTokens, mockReconciliation, apiDouble } = vi.hoisted(() => {
  const tokens = vi.fn();
  const reconciliation = vi.fn();
  const mutation = () => ({
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  });
  return {
    mockTokens: tokens,
    mockReconciliation: reconciliation,
    apiDouble: {
      api: {
        scimToken: {
          list: { useQuery: tokens },
          generate: mutation(),
          revoke: mutation(),
        },
        scimReconciliation: { getAll: { useQuery: reconciliation } },
        useUtils: () => ({
          scimToken: { list: { invalidate: vi.fn() } },
          scimReconciliation: { invalidate: vi.fn() },
        }),
      },
    },
  };
});

vi.mock("~/utils/api", () => apiDouble);

import { ConnectorsOverview, TokensSection } from "../ConnectorsSection";

const connection = ({
  connectionId,
  providerId,
  connectionState,
}: {
  connectionId: string;
  providerId: string;
  connectionState: string;
}) => ({
  connectionId,
  providerId,
  connectionState,
  verifiedDomains: [],
  state: null,
  status: { label: "", tone: "neutral" },
  lastPushedAtMs: null,
  managedPeople: 0,
  failures: [],
  remediation: "",
});

const renderTokens = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TokensSection organizationId="org_acme" mayManage />
    </ChakraProvider>,
  );

const openTheDialog = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Issue token" }));
};

describe("given the connectors overview", () => {
  beforeEach(() => {
    mockTokens.mockReturnValue({ data: [], isLoading: false });
    mockReconciliation.mockReturnValue({ data: [], isLoading: false });
  });

  describe("when an administrator reads where their provider sends people", () => {
    /** @scenario The protocol keeps its name in the body copy */
    it("names the protocol here, where the address it applies to is", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ConnectorsOverview
            organizationId="org_acme"
            mayReadMembership={false}
            maySetUpSingleSignOn
          />
        </ChakraProvider>,
      );

      // The navigation entry says Directory because that is what the page
      // holds. An IT administrator arrives having searched for SCIM, and this
      // address is the SCIM endpoint, so this is the honest place for the word.
      expect(screen.getByText(/talks to us over SCIM/i)).toBeInTheDocument();
    });
  });
});

describe("given the provisioning tokens section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokens.mockReturnValue({ data: [], isLoading: false });
  });

  describe("when the organization has a live connection and one that is not", () => {
    beforeEach(() => {
      mockReconciliation.mockReturnValue({
        data: {
          connections: [
            connection({
              connectionId: "ssoc_live",
              providerId: "okta-production",
              connectionState: "ACTIVE",
            }),
            connection({
              connectionId: "ssoc_draft",
              providerId: "entra-never-finished",
              connectionState: "DRAFT",
            }),
            connection({
              connectionId: "ssoc_gone",
              providerId: "okta-decommissioned",
              connectionState: "TORN_DOWN",
            }),
          ],
        },
        isLoading: false,
      });
    });

    // @scenario "Only live connections are offered when issuing a provisioning token"
    it("offers only the live connection to bind the token to", async () => {
      renderTokens();
      await openTheDialog();

      const chooser = screen.getByLabelText("Connection");
      const offered = within(chooser)
        .getAllByRole("option")
        .map((option) => option.textContent);

      expect(offered).toContain("okta-production");
      expect(offered).not.toContain("entra-never-finished");
      expect(offered).not.toContain("okta-decommissioned");
    });

    it("leaves issuing available, because there is something to issue against", async () => {
      renderTokens();
      await openTheDialog();

      expect(
        screen.getByRole("button", { name: "Generate token" }),
      ).toBeEnabled();
    });
  });

  describe("when no connection is live", () => {
    beforeEach(() => {
      mockReconciliation.mockReturnValue({
        data: {
          connections: [
            connection({
              connectionId: "ssoc_draft",
              providerId: "entra-never-finished",
              connectionState: "DRAFT",
            }),
          ],
        },
        isLoading: false,
      });
    });

    // @scenario "An organization with nothing live says so rather than offering an empty choice"
    it("says no connection is live rather than opening an empty chooser", async () => {
      renderTokens();
      await openTheDialog();

      expect(screen.queryByLabelText("Connection")).toBeNull();
      expect(
        screen.getByText(/No single sign-on connection is live yet/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Generate token" }),
      ).toBeDisabled();
    });
  });

  describe("when a token was issued against a connection since retired", () => {
    beforeEach(() => {
      mockReconciliation.mockReturnValue({
        data: {
          connections: [
            connection({
              connectionId: "ssoc_gone",
              providerId: "okta-decommissioned",
              connectionState: "TORN_DOWN",
            }),
          ],
        },
        isLoading: false,
      });
      mockTokens.mockReturnValue({
        data: [
          {
            id: "scim_1",
            description: "Okta production",
            connectionId: "ssoc_gone",
            createdAt: new Date("2026-01-02").toISOString(),
            lastUsedAt: null,
          },
        ],
        isLoading: false,
      });
    });

    // @scenario "A token issued against a connection since retired still names it"
    it("still names the connection the token was issued against", () => {
      renderTokens();

      expect(screen.getByText("okta-decommissioned")).toBeInTheDocument();
    });
  });
});
