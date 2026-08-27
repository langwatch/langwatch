/**
 * @vitest-environment jsdom
 *
 * The profile page: who I am here, how I get in, where I am signed in, and
 * which keys act as me. Four bands, and only the first of them changes
 * anything.
 *
 * Spec: specs/settings/profile.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  savedName: "asmith",
  updateName: vi.fn(),
  sessionUpdate: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  errorToast: vi.fn(),
  /** What the mutation's `onError` is handed, when the harness makes it fail. */
  nameFailure: null as unknown,
  publicEnv: { PASSKEYS_ENABLED: true } as Record<string, unknown>,
  identifiers: [] as unknown[],
  identifiersError: null as unknown,
  /** The account's own address, as the shell and Security read it. */
  addressConfirmation: { email: "ana@acme.com", confirmed: true } as unknown,
  addressConfirmationError: null as unknown,
  hasPassword: { hasPassword: true } as unknown,
  passwordError: null as unknown,
  twoStep: { offered: true, enabled: false } as unknown,
  passkeys: [] as unknown[],
  sessions: [] as unknown[],
  sessionsError: null as unknown,
  revokeSession: vi.fn(),
  revokeFailure: null as unknown,
  apiKeys: [] as unknown[],
  apiKeysError: null as unknown,
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_ana",
        name: harness.savedName,
        email: "ana@acme.com",
        image: null,
      },
    },
    update: harness.sessionUpdate,
  }),
  authClient: {
    useListPasskeys: () => ({ data: harness.passkeys, isPending: false }),
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: harness.publicEnv }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      personalSessions: {
        listWebSessions: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
    }),
    user: {
      updateName: {
        useMutation: ({
          onSuccess,
          onError,
        }: {
          onSuccess: () => Promise<void>;
          onError: (error: unknown) => void;
        }) => ({
          isPending: false,
          mutate: (input: { name: string }) => {
            harness.updateName(input);
            if (harness.nameFailure) onError(harness.nameFailure);
            else void onSuccess();
          },
        }),
      },
      hasPassword: {
        useQuery: () => ({
          data: harness.hasPassword,
          isPending: false,
          isError: harness.passwordError !== null,
          error: harness.passwordError,
        }),
      },
    },
    identity: {
      myIdentifiers: {
        useQuery: () => ({
          data: harness.identifiers,
          isPending: false,
          isError: harness.identifiersError !== null,
          error: harness.identifiersError,
        }),
      },
    },
    auth: {
      myAddressConfirmation: {
        useQuery: () => ({
          data: harness.addressConfirmation,
          isPending: false,
          isError: harness.addressConfirmationError !== null,
          error: harness.addressConfirmationError,
        }),
      },
    },
    twoStepVerification: {
      account: {
        useQuery: () => ({
          data: harness.twoStep,
          isPending: false,
          isError: false,
          error: null,
        }),
      },
    },
    personalSessions: {
      listWebSessions: {
        useQuery: () => ({
          data: harness.sessions,
          isLoading: false,
          isError: harness.sessionsError !== null,
          error: harness.sessionsError,
        }),
      },
      revokeWebSession: {
        useMutation: ({
          onSuccess,
          onError,
        }: {
          onSuccess: () => Promise<void>;
          onError: (error: unknown) => void;
        }) => ({
          isPending: false,
          variables: undefined,
          mutate: (input: { sessionId: string }) => {
            harness.revokeSession(input);
            if (harness.revokeFailure) onError(harness.revokeFailure);
            else void onSuccess();
          },
        }),
      },
    },
    apiKey: {
      list: {
        useQuery: () => ({
          data: harness.apiKeys,
          isPending: false,
          isError: harness.apiKeysError !== null,
          error: harness.apiKeysError,
        }),
      },
    },
  },
}));

// Only the toast is a double. `resolveErrorCopy` is the real one, so the
// words a failed read puts on screen are the registry's rather than this
// file's invention.
vi.mock("~/features/errors", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showErrorToast: (args: unknown) => harness.errorToast(args),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (args: unknown) => harness.toast(args) },
}));

// The photo control has its own tests; here it only has to be on the page.
vi.mock("~/components/me/avatar/AvatarUploadControl", () => ({
  AvatarUploadControl: () => <div data-testid="avatar-upload-control" />,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme", teams: [] },
    organizationRole: "ADMIN",
    hasPermission: () => false,
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

const ProfilePage = (await import("../profile")).default;

const DAY_MS = 86_400_000;

function renderPage() {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <ProfilePage />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

function typeName(value: string) {
  fireEvent.change(screen.getByTestId("profile-name-input"), {
    target: { value },
  });
}

beforeEach(() => {
  harness.savedName = "asmith";
  harness.nameFailure = null;
  harness.publicEnv = { PASSKEYS_ENABLED: true };
  harness.identifiers = [
    {
      identifierId: "idf_email",
      provider: "email",
      value: "ana@acme.com",
      isPrimary: true,
      confirmed: true,
    },
    {
      identifierId: "idf_google",
      provider: "google",
      value: "ana@acme.com",
      isPrimary: false,
      confirmed: true,
    },
  ];
  harness.identifiersError = null;
  harness.addressConfirmation = { email: "ana@acme.com", confirmed: true };
  harness.addressConfirmationError = null;
  harness.hasPassword = { hasPassword: true };
  harness.passwordError = null;
  harness.twoStep = { offered: true, enabled: false };
  harness.passkeys = [{ id: "pk_1", name: "Work laptop" }];
  harness.sessions = [
    {
      sessionId: "sess_here",
      method: "Email and password",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      signedInAt: new Date(Date.now() - DAY_MS).toISOString(),
      lastActiveAt: new Date(Date.now() - DAY_MS).toISOString(),
      current: true,
    },
    {
      sessionId: "sess_office",
      method: "Google",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      signedInAt: new Date(Date.now() - 40 * DAY_MS).toISOString(),
      lastActiveAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      current: false,
    },
  ];
  harness.sessionsError = null;
  harness.revokeFailure = null;
  harness.revokeSession.mockReset();
  harness.updateName.mockReset();
  harness.sessionUpdate.mockClear();
  harness.toast.mockReset();
  harness.errorToast.mockReset();
  harness.apiKeys = [
    {
      id: "key_mine",
      name: "Laptop",
      lookupIdPrefix: "lw_ab",
      permissionMode: "all",
      userId: "user_ana",
      createdAt: new Date("2026-06-01T00:00:00Z").toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    },
    {
      id: "key_theirs",
      name: "Sam's key",
      lookupIdPrefix: "lw_cd",
      permissionMode: "readonly",
      userId: "user_sam",
      createdAt: new Date("2026-06-01T00:00:00Z").toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    },
    {
      id: "key_revoked",
      name: "Old laptop",
      lookupIdPrefix: "lw_ef",
      permissionMode: "all",
      userId: "user_ana",
      createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
      lastUsedAt: null,
      revokedAt: new Date("2026-05-01T00:00:00Z").toISOString(),
    },
  ];
  harness.apiKeysError = null;
});

afterEach(() => cleanup());

describe("given my profile page", () => {
  describe("when the page renders", () => {
    /** @scenario The first band is my photo, my name and where I stand */
    /** @scenario The photo control is on the profile page */
    it("opens with my photo, my name, my address and where I stand", () => {
      renderPage();

      expect(
        screen.getByRole("heading", { name: "Profile" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("avatar-upload-control")).toBeInTheDocument();
      expect(
        (screen.getByTestId("profile-name-input") as HTMLInputElement).value,
      ).toBe("asmith");
      expect(screen.getByTestId("profile-email").textContent).toBe(
        "ana@acme.com",
      );
      expect(screen.getByTestId("profile-standing-chip").textContent).toBe(
        "Admin of Acme",
      );
    });

    /** @scenario A person with no job title is not given one */
    it("claims no job title, since a person does not have one here", () => {
      const { container } = renderPage();

      expect(container.textContent).not.toMatch(/job title|title/i);
    });
  });

  describe("when the name is changed", () => {
    /** @scenario Save stands down until the name has actually changed */
    it("offers Save only once the name is different", () => {
      renderPage();
      expect(screen.getByTestId("profile-name-save")).toBeDisabled();

      typeName("Ana Silva");
      expect(screen.getByTestId("profile-name-save")).toBeEnabled();
    });

    /** @scenario Changing my name saves it */
    it("saves the trimmed name and refreshes the session so every surface repaints", async () => {
      renderPage();
      typeName("  Ana Silva  ");

      await act(async () => {
        fireEvent.click(screen.getByTestId("profile-name-save"));
      });

      expect(harness.updateName).toHaveBeenCalledWith({ name: "Ana Silva" });
      await waitFor(() => {
        expect(harness.sessionUpdate).toHaveBeenCalledTimes(1);
      });
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Name updated", type: "success" }),
      );
    });

    /** @scenario An empty name is refused before it is sent */
    it("stands Save down on a blank name and sends nothing", () => {
      renderPage();
      typeName("   ");

      expect(screen.getByTestId("profile-name-save")).toBeDisabled();
      expect(harness.updateName).not.toHaveBeenCalled();
    });

    /** @scenario A name that could not be saved says so */
    it("says a failed save failed and keeps what was typed", async () => {
      harness.nameFailure = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      renderPage();
      typeName("Ana Silva");

      await act(async () => {
        fireEvent.click(screen.getByTestId("profile-name-save"));
      });

      expect(harness.errorToast).toHaveBeenCalledWith(
        expect.objectContaining({ fallbackTitle: "Couldn't update your name" }),
      );
      expect(
        (screen.getByTestId("profile-name-input") as HTMLInputElement).value,
      ).toBe("Ana Silva");
    });
  });

  describe("when the sign-in methods are read", () => {
    /** @scenario Each way in is one line */
    it("gives each way in a line of its own", () => {
      renderPage();

      expect(screen.getByTestId("method-row-email").textContent).toContain(
        "ana@acme.com",
      );
      expect(screen.getByTestId("method-row-federated").textContent).toContain(
        "Google",
      );
      expect(screen.getByTestId("method-row-passkeys").textContent).toContain(
        "1 passkey",
      );
      expect(screen.getByTestId("method-row-password").textContent).toContain(
        "Set",
      );
      expect(screen.getByTestId("method-row-two-step").textContent).toContain(
        "Off",
      );
    });

    /** @scenario Nothing on the summary changes anything */
    it("offers no control but the way to Security", () => {
      renderPage();

      const section = screen.getByTestId("sign-in-methods-settings-section");
      expect(within(section).queryAllByRole("button")).toEqual([]);
      expect(screen.getByTestId("sign-in-methods-manage")).toHaveAttribute(
        "href",
        "/settings/security",
      );
    });

    /** @scenario A deployment that does not offer a thing does not list it */
    it("lists neither passkeys nor two-step where the deployment offers neither", () => {
      harness.publicEnv = { PASSKEYS_ENABLED: false };
      harness.twoStep = { offered: false, enabled: false };
      renderPage();

      expect(screen.queryByTestId("method-row-passkeys")).toBeNull();
      expect(screen.queryByTestId("method-row-two-step")).toBeNull();
    });

    /** @scenario A read that fails says so without taking the band down */
    it("names the read that failed and keeps the methods it did answer", () => {
      harness.passwordError = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      renderPage();

      expect(
        screen.getByText(/Couldn't tell whether you have a password/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("method-row-email")).toBeInTheDocument();
    });
  });

  /**
   * The regression this section was reported for. An account created by a
   * passkey, or one older than the identifier projection, has an address on
   * the user record and NOTHING in the projection — and the summary read only
   * the projection, so it said "None yet" one band under the identity card
   * showing that person's own address.
   */
  describe("when the identifier projection holds nothing for this account", () => {
    /** @scenario "An account with no identifiers still states its own address" */
    it("states the address on the account rather than claiming there is none", () => {
      harness.identifiers = [];
      harness.addressConfirmation = {
        email: "alex+bunj@langwatch.ai",
        confirmed: false,
      };
      harness.passkeys = [{ id: "pk_1", name: "Work laptop" }];
      renderPage();

      const row = screen.getByTestId("method-row-email");
      expect(row.textContent).toContain("alex+bunj@langwatch.ai");
      expect(row.textContent).not.toContain("None yet");
    });

    /** @scenario "An address I have not confirmed is marked in Security's words" */
    it("marks that address unconfirmed in the words Security uses for it", () => {
      harness.identifiers = [];
      harness.addressConfirmation = {
        email: "alex+bunj@langwatch.ai",
        confirmed: false,
      };
      renderPage();

      expect(screen.getByTestId("method-row-email").textContent).toContain(
        "Not confirmed yet",
      );
    });

    /** @scenario "An address I have not confirmed is marked in Security's words" */
    it("says nothing about confirming an address the account has already confirmed", () => {
      harness.identifiers = [];
      harness.addressConfirmation = {
        email: "alex+bunj@langwatch.ai",
        confirmed: true,
      };
      renderPage();

      const row = screen.getByTestId("method-row-email");
      expect(row.textContent).toContain("alex+bunj@langwatch.ai");
      expect(row.textContent).not.toContain("Not confirmed yet");
    });

    /** @scenario "Only an account with no address anywhere is told it has none" */
    it("keeps None yet for the account that truly has no address anywhere", () => {
      harness.identifiers = [];
      harness.addressConfirmation = { email: null, confirmed: false };
      renderPage();

      expect(screen.getByTestId("method-row-email").textContent).toContain(
        "None yet",
      );
    });

    /** @scenario "The read of my own address failing says so" */
    it("names the address read that failed and keeps the other methods", () => {
      harness.identifiers = [];
      harness.addressConfirmationError = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      renderPage();

      expect(
        screen.getByText(/Couldn't read the address on your account/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("method-row-password")).toBeInTheDocument();
    });
  });

  describe("when the browsers are listed", () => {
    /** @scenario A browser and a machine are read off what the browser sent */
    /** @scenario The browser I am reading this in says so */
    it("names each browser and marks exactly one as this one", () => {
      renderPage();

      const rows = screen.getAllByTestId("browser-session-row");
      expect(rows).toHaveLength(2);
      expect(rows[0]!.textContent).toContain("Chrome on macOS");
      expect(rows[1]!.textContent).toContain("Edge on Windows");
      expect(screen.getAllByTestId("current-session-chip")).toHaveLength(1);
    });

    /** @scenario The browser I am reading this in is not offered a sign-out */
    it("offers a sign-out on every browser but the one reading this", () => {
      renderPage();

      const rows = screen.getAllByTestId("browser-session-row");
      expect(within(rows[0]!).queryByRole("button")).toBeNull();
      expect(
        within(rows[1]!).getByRole("button", { name: /Sign out/ }),
      ).toBeInTheDocument();
    });

    /** @scenario A browser nothing has happened on for a fortnight is pointed at */
    it("points at the browser that has done nothing for a month", () => {
      renderPage();

      const stale = screen.getByTestId("stale-session-chip");
      expect(stale.textContent).toBe("Not used lately");
      expect(stale.getAttribute("title")).toContain("worth a look");
    });

    /** @scenario Signing a browser out ends that one and no others */
    it("ends the browser whose row was pressed", async () => {
      renderPage();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
      });

      expect(harness.revokeSession).toHaveBeenCalledWith({
        sessionId: "sess_office",
      });
      expect(harness.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Signed that browser out" }),
      );
    });

    /** @scenario A sign-out that failed says so */
    it("says a failed sign-out failed and leaves the browser listed", async () => {
      harness.revokeFailure = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      renderPage();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
      });

      expect(harness.errorToast).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackTitle: "Couldn't sign that browser out",
        }),
      );
      expect(screen.getAllByTestId("browser-session-row")).toHaveLength(2);
    });

    it("says nothing else is signed in rather than drawing an empty band", () => {
      harness.sessions = [];
      renderPage();

      expect(screen.queryAllByTestId("browser-session-row")).toEqual([]);
      expect(
        screen.getByText(/Nothing is signed in but the browser/i),
      ).toBeInTheDocument();
    });
  });

  describe("when the API keys are listed", () => {
    /** @scenario An administrator sees their own keys, not the organization's */
    /** @scenario A revoked key is not listed as one I hold */
    it("keeps only the live keys that belong to me", () => {
      renderPage();

      const rows = screen.getAllByTestId("personal-api-key-row");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain("Laptop");
      expect(rows[0]!.textContent).toContain("lw_ab");
      // The colleague's key and my revoked one are both absent.
      expect(screen.queryByText("Sam's key")).toBeNull();
      expect(screen.queryByText("Old laptop")).toBeNull();
    });

    /** @scenario The keys are read here and managed on their own page */
    it("offers no way to issue or revoke, only the way to the page that does", () => {
      renderPage();

      const section = screen.getByTestId("personal-api-keys-settings-section");
      expect(within(section).queryAllByRole("button")).toEqual([]);
      expect(screen.getByTestId("api-keys-manage")).toHaveAttribute(
        "href",
        "/settings/api-keys",
      );
    });

    /** @scenario A key read that fails says so */
    it("names the read that failed", () => {
      harness.apiKeysError = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      renderPage();

      expect(
        screen.getByText(/Couldn't read your API keys/i),
      ).toBeInTheDocument();
    });
  });
});
