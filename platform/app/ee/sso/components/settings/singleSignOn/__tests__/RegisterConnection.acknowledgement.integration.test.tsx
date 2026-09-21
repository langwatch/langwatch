/**
 * @vitest-environment jsdom
 *
 * That a registration WORKED is said, not left to be inferred (D09 - see
 * specs/identity/sso-idp-termination.feature).
 *
 * The command settled and nothing on the form changed. The screen did move
 * once the refetch landed, but the refetch was fired and forgotten, so
 * between the two there was a window in which the button had gone idle, the
 * fields still held what the administrator typed, and the only available
 * action was to press Register a second time. On a slow connection that is
 * how an organization ends up registering twice.
 *
 * Two separate promises are checked here, because they fail separately: the
 * refetch is AWAITED, so the control stays busy until the screen holds the
 * connection; and the act is acknowledged in words, which the screen changing
 * underneath the reader does not do.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registerMock, migrateMock, invalidateMock, toastMock } = vi.hoisted(
  () => ({
    registerMock: vi.fn(),
    migrateMock: vi.fn(),
    invalidateMock: vi.fn(),
    toastMock: vi.fn(),
  }),
);

vi.mock("~/features/errors/logic/presentation", () => ({
  explainAnyError: () => ({ title: "t", describe: () => "d" }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: toastMock },
}));

vi.mock("~/utils/api", () => ({
  api: {
    ssoSetup: {
      register: { useMutation: () => ({ mutate: registerMock }) },
      startLegacyMigration: { useMutation: () => ({ mutate: migrateMock }) },
    },
    ssoConnections: {
      startLegacyMigration: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    useUtils: () => ({
      ssoSetup: { getSetup: { invalidate: invalidateMock } },
      ssoConnections: { invalidate: vi.fn() },
    }),
  },
}));

import { RegisterConnection } from "../RegisterConnection";

const SERVICE_PROVIDER = {
  redirectUrl: "https://app.test/api/auth/sso/callback/{connection}",
  assertionConsumerServiceUrl:
    "https://app.test/api/auth/sso/saml2/sp/acs/{connection}",
  singleLogoutUrl: "https://app.test/api/auth/sso/saml2/sp/slo/{connection}",
  entityId: "https://app.test/api/auth/sso/saml2/sp",
  metadataUrl:
    "https://app.test/api/auth/sso/saml2/sp/metadata?providerId={connection}",
};

function renderForm(replacesConnectionId?: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <RegisterConnection
        organizationId="org_acme"
        serviceProvider={SERVICE_PROVIDER}
        replacesConnectionId={replacesConnectionId}
      />
    </ChakraProvider>,
  );
}

/** The form only appears once a provider has been named. */
function fillAndSubmit() {
  fireEvent.click(screen.getByTestId("identity-provider-okta"));
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
}

/**
 * The options the component handed the mutation, which is where both
 * promises live - `mutate` is called with the values and then the callbacks.
 */
function settleOf(mock: ReturnType<typeof vi.fn>): {
  onSuccess: () => unknown;
} {
  return mock.mock.calls[0]?.[1] as { onSuccess: () => unknown };
}

describe("given an administrator registering an identity provider", () => {
  beforeEach(() => {
    registerMock.mockReset();
    migrateMock.mockReset();
    invalidateMock.mockReset().mockResolvedValue(undefined);
    toastMock.mockReset();
  });

  afterEach(cleanup);

  describe("when the command succeeds", () => {
    /** @scenario "Registering is acknowledged rather than left to be inferred" */
    it("says it was registered, and what to do next", async () => {
      renderForm();
      fillAndSubmit();

      await settleOf(registerMock).onSuccess();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Identity provider registered",
          type: "success",
        }),
      );
    });

    /** @scenario "Registering is acknowledged rather than left to be inferred" */
    it("waits for the screen to hold the connection before it settles", async () => {
      // A refetch that never resolves, so "awaited" is observable: if the
      // callback returned before it, the assertion below would see the toast
      // already fired. Firing and forgetting is exactly this, and it is what
      // left the form looking untouched with the command already done.
      let release: (() => void) | undefined;
      invalidateMock.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      renderForm();
      fillAndSubmit();

      const settled = settleOf(registerMock).onSuccess();
      expect(toastMock).not.toHaveBeenCalled();

      release?.();
      await settled;
      expect(toastMock).toHaveBeenCalled();
    });
  });

  describe("when the registration replaces the connection in use", () => {
    /** @scenario "Registering is acknowledged rather than left to be inferred" */
    it("says the current sign-in keeps working, which is the question that follows", async () => {
      renderForm("ssoc_predecessor");
      fillAndSubmit();

      await settleOf(migrateMock).onSuccess();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Replacement registered",
          description: expect.stringContaining("keeps working"),
        }),
      );
    });
  });
});
