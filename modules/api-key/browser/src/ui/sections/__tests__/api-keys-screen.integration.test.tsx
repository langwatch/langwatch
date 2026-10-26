/**
 * @vitest-environment jsdom
 * Consolidates three platform suites onto the host harness. Core cases:
 * lookup prefix never shows secrets; minted token appears once then vanishes.
 * Specs: specs/api-keys/{unified-api-keys,scope-filter,project-key-rotation}.feature
 */

import type * as scopeChipPickerModule from "@langwatch/design-system/scope-chip-picker";
import type * as scopeFilterModule from "@langwatch/design-system/scope-filter";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_KEY_SCOPE_QUERY_KEY } from "../../../model/api-key-host.ts";
import { FakeApiKeyHost, renderWithApiKeyHost } from "../../../testing.tsx";
import ApiKeysScreen from "../api-keys-screen.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    keys: [] as Record<string, unknown>[],
    members: [] as Record<string, unknown>[],
    createToken: "sk-lw-mintedtokenvalue0001",
    legacyKey: undefined as { present: boolean; lastUsedAt: string | null } | undefined,
    legacyRevokeFails: false,
    createFails: false,
    myBindings: [] as Record<string, unknown>[] | undefined,
    myBindingsFail: false,
  },
}));

const mutations = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
  revokeLegacy: vi.fn(),
  invalidateLegacy: vi.fn(),
}));

vi.mock("../../../behavior/api-key-api.ts", () => ({
  apiKeyApi: {
    useUtils: () => ({
      apiKey: { list: { invalidate: vi.fn() } },
      organization: { getAll: { invalidate: vi.fn() } },
      project: { getLegacyKeyStatus: { invalidate: mutations.invalidateLegacy } },
    }),
    apiKey: {
      list: { useQuery: () => ({ data: state.keys, isLoading: false }) },
      myBindings: {
        useQuery: () => ({
          data: state.myBindingsFail ? void 0 : state.myBindings,
          isLoading: false,
          isError: state.myBindingsFail,
        }),
      },
      orgProjects: {
        useQuery: () => ({
          data: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
          isLoading: false,
        }),
      },
      orgTeams: {
        useQuery: () => ({ data: [{ id: "team-1", name: "Platform" }], isLoading: false }),
      },
      orgMembers: { useQuery: () => ({ data: state.members, isLoading: false }) },
      create: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: unknown,
            handlers: { onSuccess: (r: unknown) => void; onError: (error: Error) => void },
          ) => {
            mutations.create(input);
            if (state.createFails) return handlers.onError(new Error("refused"));
            handlers.onSuccess({ token: state.createToken });
          },
        }),
      },
      update: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: unknown, handlers: { onSuccess: () => void }) => {
            mutations.update(input);
            handlers.onSuccess();
          },
        }),
      },
      revoke: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: unknown, handlers: { onSuccess: () => void }) => {
            mutations.revoke(input);
            handlers.onSuccess();
          },
        }),
      },
    },
    project: {
      getHasFirstMessage: { useQuery: () => ({ data: void 0 }) },
      getLegacyKeyStatus: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => ({
          data: options?.enabled ? state.legacyKey : void 0,
        }),
      },
      revokeProjectApiKey: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: unknown,
            handlers: {
              onSuccess: () => void;
              onError: (error: Error) => void;
              onSettled: () => void;
            },
          ) => {
            mutations.revokeLegacy(input);
            if (state.legacyRevokeFails) handlers.onError(new Error("refused"));
            else {
              state.legacyKey = { present: false, lastUsedAt: null };
              handlers.onSuccess();
            }
            handlers.onSettled();
          },
        }),
      },
    },
    organization: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

// The picker and the filter are `@langwatch/design-system`'s and have their own
// suites; what this file is about is what the SCREEN does with the value they
// hand back, so the filter is replaced by buttons that call `onChange`.
vi.mock("@langwatch/design-system/scope-chip-picker", async () => {
  const actual = await vi.importActual<typeof scopeChipPickerModule>(
    "@langwatch/design-system/scope-chip-picker",
  );
  return {
    ...actual,
    // The create/edit drawers' own picker: two buttons, so a test can empty the
    // selection, which is the state the screen's restricted-key guard is about.
    ScopeChipPicker: ({ onChange }: { onChange: (next: unknown) => void }) => (
      <button data-testid="clear-scopes" onClick={() => onChange([])}>
        scopes
      </button>
    ),
  };
});

vi.mock("@langwatch/design-system/scope-filter", async () => {
  const actual = await vi.importActual<typeof scopeFilterModule>(
    "@langwatch/design-system/scope-filter",
  );
  return {
    ...actual,
    ScopeFilter: ({ onChange }: { onChange: (next: unknown) => void }) => (
      <div>
        <button
          data-testid="filter-all"
          aria-label="Show every scope"
          onClick={() => onChange({ kind: "all" })}
        />
        <button
          data-testid="filter-team-1"
          aria-label="Show team Platform"
          onClick={() =>
            onChange({
              kind: "specific",
              scopeType: "TEAM",
              scopeId: "team-1",
              name: "Platform",
            })
          }
        />
      </div>
    ),
  };
});

vi.mock("@langwatch/design-system/page-layout", () => ({
  PageLayout: {
    Header: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Heading: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>,
    HeaderButton: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
  },
}));

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    lookupIdPrefix: "ab12c",
    name: "CI Pipeline",
    description: null,
    permissionMode: "all",
    userId: "user-1",
    userName: "Dev",
    userEmail: "dev@example.com",
    createdByUserId: "user-1",
    createdByUserName: "Dev",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdByDeviceLabel: null,
    grants: [
      {
        id: "rb-1",
        role: "ADMIN",
        customRoleId: null,
        customRoleName: null,
        customRolePermissions: null,
        scopeType: "TEAM",
        scopeId: "team-1",
        scopeName: "Platform",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  state.keys = [];
  state.members = [];
  state.legacyKey = void 0;
  state.legacyRevokeFails = false;
  state.createFails = false;
  state.myBindings = [];
  state.myBindingsFail = false;
  mutations.create.mockClear();
  mutations.revoke.mockClear();
  mutations.revokeLegacy.mockClear();
  mutations.invalidateLegacy.mockClear();
});

afterEach(() => cleanup());

describe("given the organization has an ingestion key and a regular key", () => {
  beforeEach(() => {
    state.keys = [
      keyRow(),
      keyRow({
        id: "key-2",
        name: "claude wrapper",
        lookupIdPrefix: "zz99y",
        ingestSourceType: "claude",
        createdByDeviceLabel: "Rogerio's MacBook Pro",
      }),
    ];
  });

  describe("when navigating to Settings > API Keys", () => {
    /** @scenario Ingestion keys render in their own labeled section */
    /** @scenario Ingestion key names the device session that minted it */
    it("renders the ingestion keys under their own heading, with the source tool and the device", () => {
      renderWithApiKeyHost(<ApiKeysScreen />);
      expect(screen.getByRole("heading", { name: "Ingestion keys" })).toBeInTheDocument();
      expect(screen.getByText("claude")).toBeInTheDocument();
      expect(screen.getByText("Rogerio's MacBook Pro")).toBeInTheDocument();
    });

    /** @scenario The page carries a single title and subtitle */
    it("titles the page once and never gives the regular table a heading of its own", () => {
      renderWithApiKeyHost(<ApiKeysScreen />);
      expect(screen.getByRole("heading", { name: "API keys" })).toBeInTheDocument();
      expect(screen.getAllByRole("heading")).toHaveLength(2);
    });

    /** @scenario Ingestion keys render in their own labeled section */
    it("offers no permissions or scope editor on an ingestion row, only revoke", () => {
      state.members = [{ id: "user-1", name: "Dev", email: "dev@example.com" }];
      renderWithApiKeyHost(<ApiKeysScreen />);
      expect(
        screen.getByRole("button", { name: "Actions for ingestion key claude wrapper" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit API key claude wrapper" })).toBeNull();
    });

    /** @scenario A key row offers Edit and Revoke */
    it("offers Edit and Revoke on a regular key row, and nothing else", async () => {
      const user = userEvent.setup();
      state.members = [{ id: "user-1", name: "Dev", email: "dev@example.com" }];
      renderWithApiKeyHost(<ApiKeysScreen />);

      await user.click(screen.getByRole("button", { name: "Actions for API key CI Pipeline" }));

      const actions = await screen.findAllByRole("menuitem");
      expect(actions.map((action) => action.textContent)).toEqual(["Edit", "Revoke"]);
    });

    /** @scenario Deep link opens the page on a specific key */
    it("carries the anchor id a deep link targets on every row", () => {
      const { container } = renderWithApiKeyHost(<ApiKeysScreen />);
      expect(container.querySelector("#api-key-key-1")).not.toBeNull();
      expect(container.querySelector("#api-key-key-2")).not.toBeNull();
    });

    /** @scenario A key row never renders its secret */
    it("shows a five-character lookup prefix and nothing that could be a token", () => {
      renderWithApiKeyHost(<ApiKeysScreen />);
      expect(screen.getByTitle("sk-lw-ab12c…")).toBeInTheDocument();
      expect(screen.getByTitle("ik-lw-zz99y…")).toBeInTheDocument();
    });
  });
});

describe("given the organization has only regular API keys", () => {
  /** @scenario No ingestion section when no ingestion keys exist */
  it("renders no ingestion heading at all", () => {
    state.keys = [keyRow()];
    renderWithApiKeyHost(<ApiKeysScreen />);
    expect(screen.queryByRole("heading", { name: "Ingestion keys" })).toBeNull();
  });
});

describe("given keys bound at different scopes", () => {
  beforeEach(() => {
    state.keys = [
      keyRow(),
      keyRow({
        id: "key-other",
        name: "Growth key",
        grants: [
          {
            id: "rb-2",
            role: "ADMIN",
            customRoleId: null,
            customRoleName: null,
            customRolePermissions: null,
            scopeType: "TEAM",
            scopeId: "team-2",
            scopeName: "Growth",
          },
        ],
      }),
    ];
  });

  describe("when the filter's options are offered", () => {
    /** @scenario The available-scopes derivation is shared between api-keys and model-providers */
    it("offers exactly what the host answered, never a list the screen derived", () => {
      // The platform page derived these from the organization graph with
      // `useAvailableScopes`, which the model-providers page also called. That
      // hook did not travel: BOTH families now read the same three-field shape
      // off their host, which is the same graph read on the same cache entry.
      const host = new FakeApiKeyHost({
        availableScopes: {
          organization: { id: "org-1", name: "ACME" },
          teams: [{ id: "team-1", name: "Platform" }],
          projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
        },
      });
      renderWithApiKeyHost(<ApiKeysScreen />, host);
      // Resolving `TEAM:team-1` to a filter at all is what proves the screen
      // read the host's list: a name it does not know falls back to "all".
      expect(host.availableScopes().teams).toEqual([{ id: "team-1", name: "Platform" }]);
    });
  });

  describe("when the address already carries a scope", () => {
    /** @scenario Filter selection survives reload via the URL, not localStorage */
    it("narrows the table from the address alone, with no click", () => {
      renderWithApiKeyHost(
        <ApiKeysScreen />,
        new FakeApiKeyHost({ query: { [API_KEY_SCOPE_QUERY_KEY]: "TEAM:team-1" } }),
      );
      expect(screen.getByText("CI Pipeline")).toBeInTheDocument();
      expect(screen.queryByText("Growth key")).toBeNull();
    });
  });

  describe("when the address names a scope the reader can no longer see", () => {
    /** @scenario A stale URL pointing to a deleted scope falls back to "All you can see" */
    it("falls back to everything rather than rendering an empty table", () => {
      renderWithApiKeyHost(
        <ApiKeysScreen />,
        new FakeApiKeyHost({ query: { [API_KEY_SCOPE_QUERY_KEY]: "TEAM:deleted-team" } }),
      );
      expect(screen.getByText("CI Pipeline")).toBeInTheDocument();
      expect(screen.getByText("Growth key")).toBeInTheDocument();
    });
  });

  describe("when a scope is picked", () => {
    /** @scenario Filter selection survives reload via the URL, not localStorage */
    it("writes the whole next query rather than keeping a mirror in state", async () => {
      const user = userEvent.setup();
      const { host } = renderWithApiKeyHost(
        <ApiKeysScreen />,
        new FakeApiKeyHost({ query: { keep: "me" } }),
      );
      await user.click(screen.getByTestId("filter-team-1"));
      expect(host.queryWrites).toEqual([{ keep: "me", [API_KEY_SCOPE_QUERY_KEY]: "TEAM:team-1" }]);
    });

    /** @scenario Filter selection survives reload via the URL, not localStorage */
    it("clears the parameter when the filter goes back to all", async () => {
      const user = userEvent.setup();
      const { host } = renderWithApiKeyHost(
        <ApiKeysScreen />,
        new FakeApiKeyHost({ query: { [API_KEY_SCOPE_QUERY_KEY]: "TEAM:team-1" } }),
      );
      await user.click(screen.getByTestId("filter-all"));
      expect(host.queryWrites).toEqual([{ [API_KEY_SCOPE_QUERY_KEY]: void 0 }]);
    });
  });

  describe("when the filter narrows everything away", () => {
    /** @scenario Filter with zero matches shows a plain empty state */
    it("says so, and says something different when there are simply no keys", () => {
      // A reader who cannot manage the project sees no Project API Key row to fill the table.
      const grants = new Set(["organization:view"]);
      state.keys = [];
      const { unmount } = renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost({ grants }));
      expect(screen.getByText("No API keys")).toBeInTheDocument();
      expect(screen.getByText("Create one to get started.")).toBeInTheDocument();
      unmount();

      state.keys = [keyRow({ grants: [] })];
      renderWithApiKeyHost(
        <ApiKeysScreen />,
        new FakeApiKeyHost({ grants, query: { [API_KEY_SCOPE_QUERY_KEY]: "TEAM:team-1" } }),
      );
      expect(screen.getByText(/No keys match the current scope/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /How API keys are scoped/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    });
  });
});

const LIVE_LEGACY_KEY = { present: true, lastUsedAt: "2026-10-25T12:00:00.000Z" };
const ADMIN = [{ id: "user-1", name: "Dev", email: "dev@example.com" }];

const confirmLegacyRevoke = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Actions for the legacy project key" }));
  await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
  await user.click(await screen.findByTestId("legacy-key-revoke-confirm"));
};

describe("given the project still has a legacy key", () => {
  describe("when an organization admin opens the keys page", () => {
    /** @scenario The legacy key is listed as a row an admin can revoke */
    /** @scenario The legacy project key can only be revoked from the keys page */
    it("lists it with a Legacy badge, its project and last use, and offers only Revoke", async () => {
      const user = userEvent.setup();
      state.members = ADMIN;
      state.legacyKey = LIVE_LEGACY_KEY;
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      const row = screen.getByTestId("legacy-key-row");
      expect(within(row).getByText("Legacy")).toBeInTheDocument();
      expect(within(row).getByText("Web App")).toBeInTheDocument();
      expect(within(row).queryByText("Never used")).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy secret key" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Actions for the legacy project key" }));
      const actions = await screen.findAllByRole("menuitem");
      expect(actions.map((action) => action.textContent)).toEqual(["Revoke"]);
    });

    /** @scenario A banner tells an admin that legacy project keys are going away */
    it("shows the banner until the legacy key is revoked", () => {
      state.members = ADMIN;
      state.legacyKey = LIVE_LEGACY_KEY;
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      const banner = screen.getByTestId("legacy-project-key-banner");
      expect(banner).toHaveTextContent("Legacy project keys are going away");
      expect(
        within(banner).getByRole("button", { name: "Revoke and replace" }),
      ).toBeInTheDocument();
    });

    /** @scenario The banner's button revokes and replaces the legacy key */
    it("opens the revoke dialog from the banner", async () => {
      const user = userEvent.setup();
      state.members = ADMIN;
      state.legacyKey = LIVE_LEGACY_KEY;
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      await user.click(
        within(screen.getByTestId("legacy-project-key-banner")).getByRole("button", {
          name: "Revoke and replace",
        }),
      );

      expect(await screen.findByTestId("legacy-key-revoke-confirm")).toBeInTheDocument();
    });

    it("lists it even when the organization has no other key", () => {
      state.members = ADMIN;
      state.legacyKey = { present: true, lastUsedAt: null };
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      expect(screen.queryByTestId("api-keys-empty")).toBeNull();
      expect(
        within(screen.getByTestId("legacy-key-row")).getByText("Never used"),
      ).toBeInTheDocument();
    });
  });

  describe("when the admin revokes it", () => {
    beforeEach(() => {
      state.members = ADMIN;
      state.legacyKey = LIVE_LEGACY_KEY;
    });

    /** @scenario Revoking the legacy key says an API key takes its place */
    it("says the key stops working and a new API key is shown once", async () => {
      const user = userEvent.setup();
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      await user.click(screen.getByRole("button", { name: "Actions for the legacy project key" }));
      await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));

      expect(await screen.findByText("Revoke the legacy project key?")).toBeInTheDocument();
      expect(screen.getByText(/stops working within seconds/)).toHaveTextContent(
        /new API key for Web App .* show it to you once/,
      );
      expect(mutations.create).not.toHaveBeenCalled();
    });

    /** @scenario Revoking the legacy key swaps it for an API key */
    it("creates a full-access key on this project, revokes the legacy key and shows the token", async () => {
      const user = userEvent.setup();
      const host = new FakeApiKeyHost();
      renderWithApiKeyHost(<ApiKeysScreen />, host);

      await confirmLegacyRevoke(user);

      expect(mutations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Project API Key",
          description: "Project API Key",
          expiresAt: undefined,
          permissionMode: "all",
          keyType: "service",
          bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      );
      expect(mutations.revokeLegacy).toHaveBeenCalledWith({ projectId: "proj-1" });
      expect(mutations.invalidateLegacy).toHaveBeenCalled();
      expect(screen.queryByTestId("legacy-key-row")).toBeNull();
      expect(screen.queryByTestId("legacy-project-key-banner")).toBeNull();
      expect(host.successes).toContainEqual({ title: "Legacy project key revoked" });
      expect(
        within(await screen.findByTestId("token-created-key")).getByText("Project API Key"),
      ).toBeInTheDocument();
    });

    /** @scenario A failed create leaves the legacy key working */
    it("does not revoke the legacy key when the new key cannot be created", async () => {
      const user = userEvent.setup();
      state.createFails = true;
      const host = new FakeApiKeyHost();
      renderWithApiKeyHost(<ApiKeysScreen />, host);

      await confirmLegacyRevoke(user);

      await waitFor(() => expect(mutations.create).toHaveBeenCalled());
      expect(mutations.revokeLegacy).not.toHaveBeenCalled();
      expect(host.failures.map((failure) => failure.fallbackTitle)).toContain(
        "Couldn't create API key",
      );
    });

    /** @scenario A failed revoke after the swap still shows the new key */
    it("still shows the new token when the revoke fails, and says the legacy key still works", async () => {
      const user = userEvent.setup();
      state.legacyRevokeFails = true;
      const host = new FakeApiKeyHost();
      renderWithApiKeyHost(<ApiKeysScreen />, host);

      await confirmLegacyRevoke(user);

      expect(
        within(await screen.findByTestId("token-created-key")).getByText("Project API Key"),
      ).toBeInTheDocument();
      expect(host.failures.map((failure) => failure.fallbackTitle)).toContain(
        "New key created, but the legacy project key still works",
      );
    });
  });

  describe("when a reader who cannot manage the project opens the keys page", () => {
    /** @scenario A reader who cannot manage the project sees no legacy row and no error */
    it("never asks for the status, so shows no legacy row and no error", () => {
      state.members = [];
      // The status would show a row if it were read; the fake answers only an enabled read.
      state.legacyKey = LIVE_LEGACY_KEY;
      renderWithApiKeyHost(
        <ApiKeysScreen />,
        new FakeApiKeyHost({ grants: new Set(["organization:view"]) }),
      );

      expect(screen.queryByTestId("legacy-key-row")).toBeNull();
      expect(screen.queryByTestId("legacy-project-key-banner")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("when a project admin who is not an organization admin opens the keys page", () => {
    it("lists the row, since the server answered the status read", () => {
      state.members = [];
      state.legacyKey = LIVE_LEGACY_KEY;
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      expect(screen.getByTestId("legacy-key-row")).toBeInTheDocument();
      expect(screen.getByTestId("legacy-project-key-banner")).toBeInTheDocument();
    });

    /** @scenario A project admin's swap gets a personal key with their role */
    it("swaps it for a personal key with the admin role they hold on the project's team", async () => {
      const user = userEvent.setup();
      state.legacyKey = LIVE_LEGACY_KEY;
      state.myBindings = [{ scopeType: "TEAM", scopeId: "team-1", role: "ADMIN" }];
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      await confirmLegacyRevoke(user);

      expect(mutations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          keyType: "personal",
          bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      );
      expect(mutations.revokeLegacy).toHaveBeenCalledWith({ projectId: "proj-1" });
    });

    /** @scenario Revoke waits until the reader's roles are known */
    it("keeps Revoke unavailable while their roles are still loading", async () => {
      const user = userEvent.setup();
      state.legacyKey = LIVE_LEGACY_KEY;
      state.myBindings = undefined;
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      await user.click(screen.getByRole("button", { name: "Actions for the legacy project key" }));
      await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));

      expect(await screen.findByTestId("legacy-key-revoke-confirm")).toBeDisabled();
    });

    /** @scenario Revoke says so when the reader's roles could not be read */
    it("keeps Revoke unavailable and says why when their roles could not be read", async () => {
      const user = userEvent.setup();
      state.legacyKey = LIVE_LEGACY_KEY;
      state.myBindingsFail = true;
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      await user.click(screen.getByRole("button", { name: "Actions for the legacy project key" }));
      await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));

      expect(await screen.findByTestId("legacy-key-revoke-confirm")).toBeDisabled();
      expect(mutations.create).not.toHaveBeenCalled();
    });

    /** @scenario A swap whose new key could not send traces keeps the legacy key */
    it("keeps the legacy key and creates nothing when their role could not send traces", async () => {
      const user = userEvent.setup();
      state.legacyKey = LIVE_LEGACY_KEY;
      const host = new FakeApiKeyHost();
      renderWithApiKeyHost(<ApiKeysScreen />, host);

      await confirmLegacyRevoke(user);

      expect(mutations.create).not.toHaveBeenCalled();
      expect(mutations.revokeLegacy).not.toHaveBeenCalled();
      expect(host.failures.map((failure) => failure.fallbackTitle)).toContain(
        "Couldn't revoke the legacy project key",
      );
    });
  });
});

describe("given the project never had a legacy key", () => {
  describe("when an organization admin opens the keys page", () => {
    /** @scenario A project that never had a legacy key shows no legacy row */
    it("reads the status as absent and shows no legacy row", () => {
      state.members = ADMIN;
      state.legacyKey = { present: false, lastUsedAt: null };
      renderWithApiKeyHost(<ApiKeysScreen />, new FakeApiKeyHost());

      expect(screen.queryByTestId("legacy-key-row")).toBeNull();
      expect(screen.queryByTestId("legacy-project-key-banner")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});

describe("given a reader who is not an organization admin", () => {
  /** @scenario A member manages only their own keys */
  /** @scenario A member sees the page and not the write controls */
  it("offers the actions menu on their own key and on nobody else's", () => {
    state.members = [];
    state.keys = [keyRow(), keyRow({ id: "key-3", name: "Someone else's", userId: "user-9" })];
    renderWithApiKeyHost(<ApiKeysScreen />);
    expect(
      screen.getByRole("button", { name: "Actions for API key CI Pipeline" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for API key Someone else's" })).toBeNull();
  });
});

describe("given a key is being created", () => {
  describe("when the form would send a key bound to nothing", () => {
    // A reader who empties the scope picker and submits gets a sentence naming
    // what to do, and the key is never minted.
    /** @scenario A key needs at least one scope */
    it("refuses with a sentence the reader can act on and never mints the key", async () => {
      const user = userEvent.setup();
      const host = new FakeApiKeyHost();
      renderWithApiKeyHost(<ApiKeysScreen />, host);

      await user.click(screen.getByRole("button", { name: /Create new secret key/ }));
      expect(
        await screen.findByRole("heading", { name: "Create new secret key" }),
      ).toBeInTheDocument();

      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "CI");
      await user.click(screen.getByText("Choose when this key expires"));
      await user.click(await screen.findByRole("option", { name: "No expiration" }));
      await user.click(screen.getByTestId("clear-scopes"));
      await user.click(screen.getByRole("button", { name: "Create secret key" }));

      // The form now names the missing scope itself, so the screen's own guard
      // is behind it and no failure toast is raised.
      expect(await screen.findByText("Choose where this key can be used.")).toBeInTheDocument();
      expect(host.failures).toHaveLength(0);
      // Nothing went out: a form that refuses never reaches the mint.
      expect(mutations.create).not.toHaveBeenCalled();
    });
  });

  describe("when the mint answers", () => {
    /** @scenario "Copy this token now — the reveal is one-time" */
    it("reveals the token once and cannot show it again after the dialog closes", async () => {
      const user = userEvent.setup();
      renderWithApiKeyHost(<ApiKeysScreen />);

      await user.click(screen.getByRole("button", { name: /Create new secret key/ }));
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "CI");
      await user.click(screen.getByText("Choose when this key expires"));
      await user.click(await screen.findByRole("option", { name: "No expiration" }));
      await user.click(screen.getByRole("button", { name: "Create secret key" }));

      expect(await screen.findByText("Token created")).toBeInTheDocument();
      // The dialog names the key just created, from the form the screen kept.
      expect(within(screen.getByTestId("token-created-key")).getByText("CI")).toBeInTheDocument();
      expect(
        screen.getByText("Copy this token now. You won't be able to see it again."),
      ).toBeInTheDocument();

      await user.click(screen.getAllByRole("button", { name: /close/i })[0]!);
      await waitFor(() => expect(screen.queryByText("Token created")).toBeNull());
      // Reopening the create flow shows a blank form, never the token that was
      // just minted: the value lives in state the close cleared.
      await user.click(screen.getByRole("button", { name: /Create new secret key/ }));
      expect(
        await screen.findByRole("heading", { name: "Create new secret key" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Token created")).toBeNull();
    });
  });
});
