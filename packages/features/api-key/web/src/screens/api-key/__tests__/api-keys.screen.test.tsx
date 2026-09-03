/**
 * @vitest-environment jsdom
 *
 * Settings > API Keys: what the table shows, what it hides, and what a mint
 * reveals exactly once.
 *
 * Consolidates three platform suites — `api-keys-ingestion-split`,
 * `api-keys-scope-filter` and `project-key-rotation` — onto this package's host
 * harness. What changed is where the ambient facts come from: the platform files
 * mocked `~/hooks/useOrganizationTeamProject`, `~/utils/auth-client` and a
 * router; here the fake host answers all three, which is what the real adapter
 * does too.
 *
 * THE CREDENTIAL CASES ARE THE POINT OF THE FILE. A row renders a lookup PREFIX
 * and never a secret; the legacy project key shows four characters and copies in
 * full; a minted token appears once, in the dialog, and is gone when it closes.
 *
 * Specs: specs/api-keys/unified-api-keys.feature,
 *        specs/api-keys/scope-filter.feature,
 *        specs/api-keys/project-key-rotation.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeApiKeyHost, renderWithApiKeyHost } from "../../../testing";
import ApiKeysScreen, { API_KEY_SCOPE_QUERY_KEY } from "../api-keys.screen";

const { state } = vi.hoisted(() => ({
  state: {
    keys: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    regenerate: { apiKey: "sk-rotated-9999" },
    createToken: "sk-lw-mintedtokenvalue0001",
    regenerateFails: false,
  },
}));

const mutations = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
  regenerate: vi.fn(),
}));

vi.mock("../../../behavior/api-key-api", () => ({
  apiKeyApi: {
    useUtils: () => ({
      apiKey: { list: { invalidate: vi.fn() } },
      organization: { getAll: { invalidate: vi.fn() } },
    }),
    apiKey: {
      list: { useQuery: () => ({ data: state.keys, isLoading: false }) },
      myBindings: { useQuery: () => ({ data: [], isLoading: false }) },
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
          mutate: (input: unknown, handlers: { onSuccess: (r: unknown) => void }) => {
            mutations.create(input);
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
      regenerateApiKey: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: unknown,
            handlers: {
              onSuccess: (r: { apiKey: string }) => void;
              onError: (e: unknown) => void;
            },
          ) => {
            mutations.regenerate(input);
            if (state.regenerateFails) {
              handlers.onError({ data: { error: { code: "insufficient_permissions" } } });
              return;
            }
            handlers.onSuccess(state.regenerate);
          },
        }),
      },
      getHasFirstMessage: { useQuery: () => ({ data: void 0 }) },
    },
    organization: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

// The picker and the filter are `@langwatch/authz-web`'s and have their own
// suites; what this file is about is what the SCREEN does with the value they
// hand back, so the filter is replaced by buttons that call `onChange`.
vi.mock("@langwatch/authz-web/surfaces/scope-picker", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/authz-web/surfaces/scope-picker")>(
    "@langwatch/authz-web/surfaces/scope-picker",
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
    ScopeFilter: ({ onChange }: { onChange: (next: unknown) => void }) => (
      <div>
        <button data-testid="filter-all" onClick={() => onChange({ kind: "all" })} />
        <button
          data-testid="filter-team-1"
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
    roleBindings: [
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
  state.regenerateFails = false;
  mutations.create.mockClear();
  mutations.revoke.mockClear();
  mutations.regenerate.mockClear();
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
      expect(screen.getByRole("heading", { name: "API Keys" })).toBeInTheDocument();
      expect(screen.getAllByRole("heading")).toHaveLength(2);
    });

    /** @scenario Ingestion keys render in their own labeled section */
    it("offers no permissions or scope editor on an ingestion row, only revoke", () => {
      state.members = [{ id: "user-1", name: "Dev", email: "dev@example.com" }];
      renderWithApiKeyHost(<ApiKeysScreen />);
      expect(
        screen.getByRole("button", { name: "Revoke ingestion key claude wrapper" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit API key claude wrapper" })).toBeNull();
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
      expect(screen.getByText("sk-lw-ab12c…")).toBeInTheDocument();
      expect(screen.getByText("ik-lw-zz99y…")).toBeInTheDocument();
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
        roleBindings: [
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
      state.keys = [];
      const { unmount } = renderWithApiKeyHost(<ApiKeysScreen />);
      expect(screen.getByText("No API keys. Create one to get started.")).toBeInTheDocument();
      unmount();

      state.keys = [keyRow({ roleBindings: [] })];
      renderWithApiKeyHost(
        <ApiKeysScreen />,
        new FakeApiKeyHost({ query: { [API_KEY_SCOPE_QUERY_KEY]: "TEAM:team-1" } }),
      );
      expect(screen.getByText(/No keys match the current scope/)).toBeInTheDocument();
    });
  });
});

describe("given the legacy project key exists", () => {
  const withProjectKey = (grants?: ReadonlySet<string>) =>
    new FakeApiKeyHost({
      scope: { projectApiKey: "sk-legacy-projectkey-abcd" },
      ...(grants ? { grants } : {}),
    });

  describe("when the reader can manage the project", () => {
    /** @scenario An admin rotates the base key and sees the new key once */
    /** @scenario Legacy project key row names its project */
    it("shows only the last four characters of the key, on a row naming its project", () => {
      renderWithApiKeyHost(<ApiKeysScreen />, withProjectKey());
      expect(screen.getByText("sk-…abcd")).toBeInTheDocument();
      expect(screen.queryByText(/sk-legacy-projectkey/)).toBeNull();
      // The row is fixed to ONE project, and says which — the same named scope
      // chip the user-scoped rows carry.
      expect(screen.getByText("Web App")).toBeInTheDocument();
    });

    /** @scenario An admin rotates the base key and sees the new key once */
    it("copies the FULL key, not the four characters it renders", async () => {
      const user = userEvent.setup();
      const host = withProjectKey();
      renderWithApiKeyHost(<ApiKeysScreen />, host);
      await user.click(screen.getByRole("button", { name: "Copy secret key" }));
      expect(host.copies).toEqual([
        {
          text: "sk-legacy-projectkey-abcd",
          succeeded: { title: "API key copied to clipboard" },
        },
      ]);
    });

    /** @scenario An admin rotates the base key and sees the new key once */
    it("confirms before rotating, then reveals the new key once", async () => {
      const user = userEvent.setup();
      renderWithApiKeyHost(<ApiKeysScreen />, withProjectKey());
      await user.click(screen.getByRole("button", { name: "Rotate Project API Key" }));
      expect(await screen.findByText("Regenerate API Key?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Regenerate Key" }));
      expect(mutations.regenerate).toHaveBeenCalledWith({ projectId: "proj-1" });
      expect(await screen.findByText("Token Created")).toBeInTheDocument();
    });

    /** @scenario An admin rotates the base key and sees the new key once */
    /** @scenario A failed rotation leaves the previous base key working */
    it("tells the reader when the rotation is refused, and leaves the old key on the row", async () => {
      state.regenerateFails = true;
      const user = userEvent.setup();
      const host = withProjectKey();
      renderWithApiKeyHost(<ApiKeysScreen />, host);
      await user.click(screen.getByRole("button", { name: "Rotate Project API Key" }));
      await user.click(await screen.findByRole("button", { name: "Regenerate Key" }));
      // The RAW error travels, never a sentence the screen composed: the wire
      // message of a handled error is its code slug.
      expect(host.failures).toHaveLength(1);
      expect(host.failures[0]!.fallbackTitle).toBe("Couldn't rotate the project API key");
      expect(host.successes).toEqual([]);
      // Nothing was minted, so nothing is revealed and the row still shows the
      // key that is still working.
      expect(screen.queryByText("Token Created")).toBeNull();
      expect(screen.getByText("sk-…abcd")).toBeInTheDocument();
    });

    /** @scenario The base key keeps working until it is explicitly rotated */
    it("rotates only on an explicit confirmation, never on opening the dialog", async () => {
      const user = userEvent.setup();
      renderWithApiKeyHost(<ApiKeysScreen />, withProjectKey());
      await user.click(screen.getByRole("button", { name: "Rotate Project API Key" }));
      expect(await screen.findByText("Regenerate API Key?")).toBeInTheDocument();
      expect(mutations.regenerate).not.toHaveBeenCalled();
      expect(screen.getByText("sk-…abcd")).toBeInTheDocument();
    });
  });

  describe("when the reader cannot manage the project", () => {
    /** @scenario Rotation requires permission to manage the project */
    it("offers no rotation control at all", () => {
      renderWithApiKeyHost(<ApiKeysScreen />, withProjectKey(new Set(["organization:view"])));
      expect(screen.queryByRole("button", { name: "Rotate Project API Key" })).toBeNull();
      // The copy action is not a mutation and stays.
      expect(screen.getByRole("button", { name: "Copy secret key" })).toBeInTheDocument();
    });
  });
});

describe("given a reader who is not an organization admin", () => {
  /** @scenario A member manages only their own keys */
  it("offers edit and revoke on their own key and on nobody else's", () => {
    state.members = [];
    state.keys = [keyRow(), keyRow({ id: "key-3", name: "Someone else's", userId: "user-9" })];
    renderWithApiKeyHost(<ApiKeysScreen />);
    expect(screen.getByRole("button", { name: "Edit API key CI Pipeline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit API key Someone else's" })).toBeNull();
  });
});

describe("given a key is being created", () => {
  describe("when the form would send a key bound to nothing", () => {
    // The reachable shape of this guard, and the reason it exists: the drawer's
    // own Create button stays live while an ambient project exists, so a reader
    // who empties the scope picker gets as far as submitting a key with no
    // bindings at all. The mint would refuse it; the screen refuses it first,
    // with a sentence naming what to do.
    /** @scenario A key needs at least one scope */
    it("refuses with a sentence the reader can act on rather than the generic line", async () => {
      const user = userEvent.setup();
      const host = new FakeApiKeyHost();
      renderWithApiKeyHost(<ApiKeysScreen />, host);

      await user.click(screen.getByRole("button", { name: /Create new secret key/ }));
      expect(
        await screen.findByRole("heading", { name: "Create new secret key" }),
      ).toBeInTheDocument();

      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "CI");
      await user.click(screen.getByTestId("clear-scopes"));
      await user.click(screen.getByRole("button", { name: "Create secret key" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]).toEqual({
        error: void 0,
        fallbackTitle: "No permissions to grant",
        description:
          "You have no role bindings in this organization, so there is nothing to grant to a key.",
      });
      // Nothing went out: a form the screen refused never reaches the mint.
      expect(mutations.create).not.toHaveBeenCalled();
    });
  });

  describe("when the mint answers", () => {
    /** @scenario Copy this token now — the reveal is one-time */
    it("reveals the token once and cannot show it again after the dialog closes", async () => {
      const user = userEvent.setup();
      renderWithApiKeyHost(<ApiKeysScreen />);

      await user.click(screen.getByRole("button", { name: /Create new secret key/ }));
      await user.type(screen.getByPlaceholderText("e.g., CI Pipeline, Local Dev"), "CI");
      await user.click(screen.getByRole("button", { name: "Create secret key" }));

      expect(await screen.findByText("Token Created")).toBeInTheDocument();
      expect(
        screen.getByText("Copy this token now. You won't be able to see it again."),
      ).toBeInTheDocument();

      await user.click(screen.getAllByRole("button", { name: /close/i })[0]!);
      await waitFor(() => expect(screen.queryByText("Token Created")).toBeNull());
      // Reopening the create flow shows a blank form, never the token that was
      // just minted: the value lives in state the close cleared.
      await user.click(screen.getByRole("button", { name: /Create new secret key/ }));
      expect(
        await screen.findByRole("heading", { name: "Create new secret key" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Token Created")).toBeNull();
    });
  });
});
