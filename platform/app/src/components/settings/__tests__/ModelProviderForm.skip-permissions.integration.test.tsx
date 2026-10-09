/**
 * @vitest-environment jsdom
 *
 * The Advanced section of the model-provider drawer carries the models
 * allowed to skip Langy's permission checks.
 *
 * Covers the @integration scenarios of
 * specs/settings/model-provider-skip-permissions.feature.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMutateAsync,
  mockGetAllForProjectForFrontendQuery,
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
  mockCloseDrawer,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({}),
  mockGetAllForProjectForFrontendQuery: vi.fn(),
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
  mockCloseDrawer: vi.fn(),
}));

vi.mock("../../../utils/api", () => ({
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
      update: { useMutation: () => ({ mutateAsync: mockMutateAsync }) },
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
        }),
      },
      isManagedProvider: { useQuery: () => ({ data: { managed: false } }) },
    },
    useUtils: () => ({
      organization: { getAll: { invalidate: vi.fn() } },
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

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: mockCloseDrawer, openDrawer: vi.fn() }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
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

vi.mock("../../../hooks/useModelProviderApiKeyValidation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: vi.fn().mockResolvedValue(true),
    validateWithCustomUrl: vi.fn().mockResolvedValue(true),
    isValidating: false,
    validationError: undefined,
    clearError: vi.fn(),
  }),
}));

// The AI Gateway section is off, so the Advanced accordion here holds the
// skip-permissions field alone. That is the point: the field does not belong
// to the gateway and must not be gated behind it.
vi.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../ui/toaster", () => ({ toaster: { create: vi.fn() } }));

import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { modelProviders } from "../../../server/modelProviders/registry";
import { EditModelProviderForm } from "../ModelProviderForm";
import {
  keyedRow,
  makePrimeQueries,
  Wrapper,
} from "./modelProviderDrawerHarness";

const primeQueries = makePrimeQueries({
  collapsedQuery: mockGetAllForProjectForFrontendQuery,
  organizationListQuery: mockListAllForOrganizationForFrontendQuery,
  projectListQuery: mockListAllForProjectForFrontendQuery,
});

const FIELD_LABEL = "Models allowed to skip Langy permission checks";

function openAiRow(
  langySkipPermissionsModels: string[] | null,
): MaybeStoredModelProvider {
  return {
    ...keyedRow({
      providerKey: "openai",
      apiKey: "OPENAI_API_KEY",
      baseUrl: "OPENAI_BASE_URL",
    }),
    langySkipPermissionsModels,
  };
}

function renderDrawer() {
  return render(
    <Wrapper>
      <EditModelProviderForm
        projectId="proj-1"
        organizationId="org-1"
        providerKey="openai"
        modelProviderId="row-openai"
      />
    </Wrapper>,
  );
}

function openAdvanced() {
  fireEvent.click(screen.getByText("Advanced"));
}

function skipField(): HTMLTextAreaElement {
  return screen.getByLabelText(FIELD_LABEL) as HTMLTextAreaElement;
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
}

describe("Feature: a provider says which models may skip Langy's permission checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    primeQueries([openAiRow(null)]);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the model provider drawer is open", () => {
    describe("when I open the Advanced section", () => {
      /** @scenario The Advanced section holds the allowed models list */
      it("titles the section Advanced and offers the allowed models field, one pattern per line", () => {
        renderDrawer();
        openAdvanced();

        expect(screen.getByText("Advanced")).toBeInTheDocument();
        expect(screen.queryByText(/advanced \(gateway\)/i)).toBeNull();
        expect(skipField()).toBeInTheDocument();
        expect(skipField().tagName).toBe("TEXTAREA");
        expect(screen.getByText("One pattern per line.")).toBeInTheDocument();
      });
    });

    describe("when I enter two patterns and save", () => {
      /** @scenario Saving the list keeps it on the provider */
      it("sends both patterns, and reopening the drawer shows them back", async () => {
        renderDrawer();
        openAdvanced();
        fireEvent.change(skipField(), {
          target: { value: "^gpt-9$\n^gpt-10$" },
        });
        save();

        await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
        expect(mockMutateAsync.mock.calls[0]?.[0]).toMatchObject({
          langySkipPermissionsModels: ["^gpt-9$", "^gpt-10$"],
        });

        cleanup();
        primeQueries([openAiRow(["^gpt-9$", "^gpt-10$"])]);
        renderDrawer();
        openAdvanced();

        expect(skipField().value).toBe("^gpt-9$\n^gpt-10$");
      });
    });

    describe("when I enter a pattern that is not a valid regular expression and save", () => {
      /** @scenario An invalid pattern is rejected on the field */
      it("shows which line is invalid on the field, and saves nothing", async () => {
        mockMutateAsync.mockRejectedValue({
          error: {
            code: "model_provider_skip_permissions_pattern_invalid",
            message:
              "Line 2 of the allowed models list is not a valid pattern.",
            meta: {
              line: 2,
              pattern: "^(unclosed",
              fieldErrors: {
                langySkipPermissionsModels: ["Line 2 is not a valid pattern."],
              },
            },
          },
        });

        renderDrawer();
        openAdvanced();
        fireEvent.change(skipField(), {
          target: { value: "^gpt-9$\n^(unclosed" },
        });
        save();

        await waitFor(() =>
          expect(
            screen.getByText("Line 2 is not a valid pattern."),
          ).toBeInTheDocument(),
        );
        expect(mockCloseDrawer).not.toHaveBeenCalled();
      });
    });

    describe("given I saved a custom list", () => {
      describe("when I clear the field and save", () => {
        /** @scenario Clearing the field restores the provider's default list */
        it("sends an empty list and shows the provider's defaults as placeholder text", async () => {
          primeQueries([openAiRow(["^gpt-9$"])]);
          renderDrawer();
          openAdvanced();
          expect(skipField().value).toBe("^gpt-9$");

          fireEvent.change(skipField(), { target: { value: "" } });
          save();

          await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
          expect(mockMutateAsync.mock.calls[0]?.[0]).toMatchObject({
            langySkipPermissionsModels: [],
          });
          expect(skipField().placeholder).toBe(
            modelProviders.openai.langySkipPermissionsModels.join("\n"),
          );
        });
      });
    });
  });
});
