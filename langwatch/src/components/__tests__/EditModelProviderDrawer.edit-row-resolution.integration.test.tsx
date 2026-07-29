/**
 * @vitest-environment jsdom
 * @regression
 *
 * Regression tests for issue #5380 at the drawer level (not just the bare
 * form). The settings-page edit affordance opens `EditModelProviderDrawer`,
 * which independently resolves BOTH a header title AND (by mounting
 * `EditModelProviderForm`) the credential fields. Both resolutions must
 * agree on which row is being edited.
 *
 * These tests pin three implementation details introduced by the #5380
 * fix that the drawer-title path and the "new provider" path depend on:
 *   - the header title resolves the SAME row as the form (against the
 *     uncollapsed flat list from `useAllModelProvidersList`, not the
 *     collapsed per-provider-type record) — see the "Editing a row shows
 *     its own saved credential, not another row's" and "Saving an edited
 *     row updates it in place, not as a duplicate" scenarios in
 *     specs/model-providers/scope-and-multi-instance.feature, which this
 *     file does not re-bind (already bound in
 *     ModelProviderForm.edit-row-resolution.integration.test.tsx).
 *   - the form does not mount off the blank id-less draft while the flat
 *     list is still loading (isFormDataLoading)
 *   - opening the drawer for a brand-new row (modelProviderId="new") does
 *     NOT search the flat list by the literal id "new" — it must fall
 *     back to the collapsed per-provider-type record, same as the form's
 *     own "new" guard, so the header still shows a sensible title.
 *
 * `EditModelProviderForm`, `useAllModelProvidersList`, and
 * `useModelProvidersSettings` are NOT mocked — only the tRPC boundary and
 * peripheral hooks are, and `../ui/drawer` is replaced with plain
 * passthrough elements (Chakra's real Drawer.Root renders through a
 * Portal with focus-trap/dismissable-layer machinery; see
 * TraceDetailsDrawer.integration.test.tsx for the same substitution) so
 * the header/body content this file asserts on still renders for real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockGetAllForProjectForFrontendQuery,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockGetAllForProjectForFrontendQuery: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProjectForFrontend: {
        useQuery: mockGetAllForProjectForFrontendQuery,
      },
      listAllForOrganizationForFrontend: {
        useQuery: mockListAllForOrganizationForFrontendQuery,
      },
      listAllForProjectForFrontend: {
        useQuery: mockListAllForProjectForFrontendQuery,
      },
      update: {
        useMutation: () => ({ mutateAsync: mockMutateAsync }),
      },
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        }),
      },
      isManagedProvider: {
        useQuery: () => ({ data: { managed: false } }),
      },
    },
    useContext: () => ({
      organization: {
        getAll: { invalidate: vi.fn() },
      },
      modelProvider: {
        getAllForProject: { invalidate: vi.fn() },
        getAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForOrganizationForFrontend: { invalidate: vi.fn() },
        getResolvedDefault: { invalidate: vi.fn() },
        getDefaultModelsForProject: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
  }),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", name: "Web App", slug: "web-app" },
    team: { id: "team-1", name: "Platform" },
    organization: {
      id: "org-1",
      name: "Acme",
      teams: [
        {
          id: "team-1",
          name: "Platform",
          projects: [{ id: "proj-1", name: "Web App" }],
        },
      ],
    },
    hasPermission: () => true,
  }),
}));

vi.mock("../../hooks/useModelProviderApiKeyValidation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: vi.fn().mockResolvedValue(true),
    validateWithCustomUrl: vi.fn().mockResolvedValue(true),
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

vi.mock("../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Chakra's real Drawer.Root renders through a Portal with focus-trap /
// dismissable-layer machinery that existing drawer tests in this repo
// avoid exercising directly (see TraceDetailsDrawer.integration.test.tsx).
// Replace the shell with plain passthrough elements so the header/body
// CONTENT (title, spinner, form) — what these tests actually assert on —
// still renders for real.
vi.mock("../ui/drawer", () => ({
  Drawer: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CloseTrigger: () => <button aria-label="Close drawer" type="button" />,
  },
}));

import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../utils/constants";
import { EditModelProviderDrawer } from "../EditModelProviderDrawer";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Same two-scope shape as ModelProviderForm.edit-row-resolution.integration.test.tsx:
// rowA is org-scoped (the edit target, absent from the collapsed record),
// rowB is project-scoped (the collapse winner for the "openai" type).
// rowB carries its OWN credential values so a wrong-row resolution renders
// observably different form content — same provider type, so the header
// title (the registry name for the TYPE, not the row's `name`) cannot
// discriminate the two rows; the credential fields can.
const rowA: MaybeStoredModelProvider = {
  id: "row-a",
  name: "OpenAI",
  provider: "openai",
  enabled: true,
  customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER, OPENAI_BASE_URL: "" },
  models: null,
  embeddingsModels: null,
  customModels: null,
  customEmbeddingsModels: null,
  disabledByDefault: false,
  deploymentMapping: null,
  extraHeaders: [],
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
};

const rowB: MaybeStoredModelProvider = {
  ...rowA,
  id: "row-b",
  customKeys: {
    OPENAI_API_KEY: "sk-row-b-key",
    OPENAI_BASE_URL: "https://row-b.example.com",
  },
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
  scopeType: "PROJECT",
  scopeId: "proj-1",
};

/**
 * Minimal but *realistic* TanStack Query v4 result. `useAllModelProvidersList`
 * derives its spinner signal from `isSuccess`/`isError`, not just `isLoading`
 * — a mock that omits them leaves those gates `undefined` (silently falsy), so
 * the drawer's spinner/mount gate would be exercised by accident. These
 * helpers set the full status triplet.
 */
function readyQueryResult<T>(data: T) {
  return {
    data,
    isSuccess: true,
    isError: false,
    isLoading: false,
    status: "success" as const,
    refetch: vi.fn(),
  };
}

function notReadyQueryResult() {
  return {
    data: undefined,
    isSuccess: false,
    isError: false,
    isLoading: true,
    status: "loading" as const,
    refetch: vi.fn(),
  };
}

/** Collapsed record has only rowB; flat list has both rows; every query resolved. */
function primeQueriesLoaded() {
  mockGetAllForProjectForFrontendQuery.mockReturnValue(
    readyQueryResult({ providers: { openai: rowB }, modelMetadata: {} }),
  );
  const flat = readyQueryResult({ providers: [rowA, rowB], modelMetadata: {} });
  mockListAllForOrganizationForFrontendQuery.mockReturnValue(flat);
  mockListAllForProjectForFrontendQuery.mockReturnValue(flat);
}

/**
 * Collapsed record resolved normally; BOTH flat-list queries (org and project
 * variants) still in-flight — no definitive answer yet (`isSuccess: false,
 * isError: false`), so the hook's spinner signal stays true and the drawer
 * must keep spinning rather than mount the form off an empty list.
 * `hasPermission` mocks true, so `useAllModelProvidersList` reads the org
 * variant; priming both keeps this fixture correct regardless of branch.
 */
function primeQueriesFlatListLoading() {
  mockGetAllForProjectForFrontendQuery.mockReturnValue(
    readyQueryResult({ providers: { openai: rowB }, modelMetadata: {} }),
  );
  const flat = notReadyQueryResult();
  mockListAllForOrganizationForFrontendQuery.mockReturnValue(flat);
  mockListAllForProjectForFrontendQuery.mockReturnValue(flat);
}

function renderDrawer(
  props: Partial<Parameters<typeof EditModelProviderDrawer>[0]> = {},
) {
  const defaultProps = {
    projectId: "proj-1",
    organizationId: "org-1",
    modelProviderId: "row-a",
    providerKey: "openai",
  };
  return render(
    <Wrapper>
      <EditModelProviderDrawer {...defaultProps} {...props} />
    </Wrapper>,
  );
}

describe("<EditModelProviderDrawer/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an org-scoped and a project-scoped openai row both exist", () => {
    describe("when the drawer opens targeting the org-scoped row by id", () => {
      beforeEach(() => {
        primeQueriesLoaded();
        renderDrawer({ modelProviderId: "row-a" });
      });

      it("shows the targeted row's provider title in the header", () => {
        // The header renders the registry display name for the provider
        // TYPE, so with two same-type rows this alone proves a row
        // resolved at all (a missed lookup renders an empty heading) —
        // the row-discriminating check is the credential assertion below.
        expect(screen.getByRole("heading", { name: "OpenAI" })).toBeTruthy();
      });

      it("mounts the form on the targeted row's credential, not the collapse winner's", () => {
        // row-a's key renders masked; a regression to the collapsed
        // Record would resolve row-b and render row-b's values instead.
        expect(screen.getByDisplayValue(MASKED_KEY_PLACEHOLDER)).toBeTruthy();
        expect(screen.queryByDisplayValue("sk-row-b-key")).toBeNull();
        expect(
          screen.queryByDisplayValue("https://row-b.example.com"),
        ).toBeNull();
      });
    });
  });

  describe("given the flat provider list is still loading", () => {
    describe("when the drawer opens targeting a specific row by id", () => {
      beforeEach(() => {
        primeQueriesFlatListLoading();
        renderDrawer({ modelProviderId: "row-a" });
      });

      it("renders a loading spinner", () => {
        expect(
          document.querySelectorAll(".chakra-spinner").length,
        ).toBeGreaterThan(0);
      });

      it("does not mount the form", () => {
        expect(screen.queryByText("OPENAI_API_KEY")).toBeNull();
      });
    });
  });

  describe("given the collapsed record already has an openai row", () => {
    describe("when the drawer opens for a brand-new row (modelProviderId=new)", () => {
      beforeEach(() => {
        primeQueriesLoaded();
        renderDrawer({ modelProviderId: "new" });
      });

      it("shows the provider-type title from the collapsed record", () => {
        expect(screen.getByRole("heading", { name: "OpenAI" })).toBeTruthy();
      });

      it("still mounts the form", () => {
        expect(screen.getByText("OPENAI_API_KEY")).toBeTruthy();
      });
    });
  });
});
