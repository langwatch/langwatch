/**
 * @vitest-environment jsdom
 *
 * Unlinking a linked account, and the question asked first.
 *
 * "Are you sure" is not a question anybody can answer, so the three things
 * this dialog has to say are what is tested: what stays behind, whether it
 * comes back, and whether something else becomes primary on the way.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  accountsRef,
  identifiersRef,
  organizationRef,
  unlinkMock,
  publicEnvRef,
} = vi.hoisted(() => ({
  accountsRef: { current: [] as unknown[] },
  identifiersRef: { current: [] as unknown[] },
  organizationRef: { current: {} as Record<string, unknown> },
  unlinkMock: vi.fn(),
  publicEnvRef: { current: { NEXTAUTH_PROVIDER: "auth0" } as unknown },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      user: {
        getLinkedAccounts: { invalidate: vi.fn() },
        hasPassword: { invalidate: vi.fn() },
      },
      identity: { myIdentifiers: { invalidate: vi.fn() } },
    }),
    user: {
      getLinkedAccounts: {
        useQuery: () => ({ data: accountsRef.current, isLoading: false }),
      },
      unlinkAccount: {
        useMutation: () => ({ mutateAsync: unlinkMock, isPending: false }),
      },
    },
    identity: {
      myIdentifiers: {
        useQuery: () => ({ data: identifiersRef.current, isPending: false }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ organization: organizationRef.current }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("~/utils/auth-client", () => ({
  linkAccount: vi.fn(),
}));

import { LinkedAccountRows } from "../LinkedAccountsSection";

const renderSection = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LinkedAccountRows />
    </ChakraProvider>,
  );

const identifier = (overrides: Record<string, unknown>) => ({
  identifierId: "id_1",
  accountId: "acct_sso",
  provider: "oidc",
  value: "sam@acme.test",
  isPrimary: false,
  confirmed: true,
  resendable: false,
  removable: true,
  refusalCode: null,
  demotesFirst: false,
  ...overrides,
});

describe("unlinking a linked account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unlinkMock.mockResolvedValue(undefined);
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "auth0" };
    organizationRef.current = {};
    accountsRef.current = [
      { id: "acct_sso", provider: "okta", providerAccountId: "okta|sam" },
    ];
    identifiersRef.current = [
      identifier({}),
      identifier({
        identifierId: "id_email",
        accountId: "acct_email",
        provider: "email",
      }),
    ];
  });

  afterEach(() => {
    cleanup();
  });

  describe("given another confirmed way in", () => {
    describe("when the linked account is unlinked", () => {
      /** @scenario Unlinking a single sign-on method asks first and says what stays */
      it("asks first and names what is left behind", async () => {
        renderSection();

        fireEvent.click(screen.getByTestId("unlink-method"));

        const dialog = await screen.findByTestId("unlink-method-dialog");
        expect(dialog.textContent).toContain("sam@acme.test");
        // Nothing has happened yet: the question is a question.
        expect(unlinkMock).not.toHaveBeenCalled();
      });

      /** @scenario Unlinking a single sign-on method asks first and says what stays */
      it("only removes it once the question is answered", async () => {
        renderSection();

        fireEvent.click(screen.getByTestId("unlink-method"));
        await screen.findByTestId("unlink-method-dialog");
        fireEvent.click(screen.getByTestId("confirm-unlink-method"));

        await waitFor(() => {
          expect(unlinkMock).toHaveBeenCalledWith({ accountId: "acct_sso" });
        });
      });
    });
  });

  describe("given an organization that signs people in through single sign-on", () => {
    /** @scenario A member of an organization that enforces single sign-on is told it comes back */
    it("says the next single sign-on links it again, and allows it", async () => {
      organizationRef.current = { ssoProvider: "okta" };
      renderSection();

      fireEvent.click(screen.getByTestId("unlink-method"));

      const notice = await screen.findByTestId("unlink-relinks-on-sso");
      expect(notice.textContent).toMatch(/linked again/i);
      // Allowed rather than blocked: nothing is lost that does not return.
      expect(screen.getByTestId("confirm-unlink-method")).toHaveProperty(
        "disabled",
        false,
      );
    });
  });

  describe("given the linked account is the primary identifier", () => {
    /** @scenario Unlinking a primary single sign-on method demotes it first */
    it("says another way in becomes primary before it goes", async () => {
      identifiersRef.current = [
        identifier({ isPrimary: true, demotesFirst: true }),
        identifier({
          identifierId: "id_email",
          accountId: "acct_email",
          provider: "email",
        }),
      ];
      renderSection();

      fireEvent.click(screen.getAllByTestId("unlink-method")[0]!);

      const dialog = await screen.findByTestId("unlink-method-dialog");
      expect(dialog.textContent).toMatch(/becomes primary first/i);
    });
  });

  describe("given the only other way in is a passkey", () => {
    /** @scenario A passkey on its own does not make unlinking safe */
    it("stands the unlink down, because no message could reach anybody", () => {
      identifiersRef.current = [
        identifier({
          removable: false,
          refusalCode: "identity_detach_strands_user",
        }),
        identifier({
          identifierId: "id_passkey",
          accountId: null,
          provider: "passkey",
          value: null,
        }),
      ];
      renderSection();

      expect(screen.getByTestId("unlink-method")).toHaveProperty(
        "disabled",
        true,
      );
      expect(screen.getByTestId("unlink-method-blocked")).toBeTruthy();
    });
  });

  describe("given the section is asked what it can connect", () => {
    /** @scenario The password and the linked accounts are separate sections */
    it("lists the linked provider without any password affordance", () => {
      accountsRef.current = [
        { id: "acct_sso", provider: "okta", providerAccountId: "okta|sam" },
        {
          id: "acct_password",
          provider: "credential",
          providerAccountId: "sam@acme.test",
        },
      ];
      renderSection();

      // The credential row belongs to the password section now, so this one
      // draws exactly one row: the identity provider.
      expect(screen.getAllByTestId("linked-account-row")).toHaveLength(1);
      expect(
        screen.queryByRole("button", { name: /Change Password/i }),
      ).toBeNull();
    });
  });
});
