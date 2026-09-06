/**
 * @vitest-environment jsdom
 *
 * The scenario editor declares parameters: the footer names them and opens
 * their editor, rows round-trip through the scenario being saved, an existing
 * scenario's declarations prefill them, and a name outside the identifier
 * grammar is refused where it was typed instead of failing silently on save.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));
vi.mock("../../agents/AgentTypeSelectorDrawer", () => ({
  AgentTypeSelectorDrawer: () => null,
}));
vi.mock("../ScenarioEditorSidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));
vi.mock("../ScenarioRunModelDialog", () => ({
  ScenarioRunModelDialog: () => null,
}));
vi.mock("../SaveAndRunMenu", () => ({
  SaveAndRunMenu: ({
    onSaveWithoutRunning,
  }: {
    onSaveWithoutRunning?: () => void;
  }) => (
    <button data-testid="save-button" onClick={onSaveWithoutRunning}>
      Save
    </button>
  ),
}));

import { ScenarioFormDrawer } from "../ScenarioFormDrawer";

const mocks = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockGetByIdData: null as Record<string, unknown> | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      create: {
        useMutation: ({
          onSuccess,
        }: {
          onSuccess?: (data: unknown) => void;
        }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            const result = await mocks.mockCreateMutateAsync(input);
            onSuccess?.(result);
            return result;
          }),
          isPending: false,
        }),
      },
      update: {
        useMutation: ({
          onSuccess,
        }: {
          onSuccess?: (data: unknown) => void;
        }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            const result = await mocks.mockUpdateMutateAsync(input);
            onSuccess?.(result);
            return result;
          }),
          isPending: false,
        }),
      },
      getById: {
        useQuery: () => ({ data: mocks.mockGetByIdData, isLoading: false }),
      },
    },
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(() => true),
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({ scenarioId: "scenario-1" }),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
  clearFlowCallbacks: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", slug: "my-project" },
    organization: { id: "org-123" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    pathname: "/[project]/simulations/scenarios",
    asPath: "/my-project/simulations/scenarios",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));

vi.mock("~/hooks/useScenarioTarget", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** The scenario the drawer edits, with whatever parameters it declares. */
function scenarioDeclaring(parameters: unknown[]) {
  return {
    id: "scenario-1",
    name: "Refund request",
    situation: "A customer asks for a refund",
    criteria: ["Stays empathetic"],
    labels: ["billing"],
    parameters,
  };
}

function renderDrawer() {
  // Being pointed at a scenario is what makes this an edit, so the id is what
  // decides that a save updates rather than creates. These scenarios are all about
  // a scenario that already exists, so they say so.
  render(
    <ScenarioFormDrawer
      open={true}
      onClose={vi.fn()}
      scenarioId="scenario-1"
    />,
    {
      wrapper: Wrapper,
    },
  );
  return userEvent.setup();
}

/** Opens the parameters editor the way a user does, from the footer. */
async function openParametersEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("edit-scenario-parameters"));
  await screen.findByTestId("scenario-parameters-list");
}

async function clickDone(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("scenario-parameters-done"));
  await waitFor(() => {
    expect(
      screen.queryByTestId("scenario-parameters-list"),
    ).not.toBeInTheDocument();
  });
}

/** Saves the scenario, returning what the update carried. */
async function save(
  user: ReturnType<typeof userEvent.setup>,
): Promise<Record<string, unknown> | null> {
  await user.click(screen.getByTestId("save-button"));
  await waitFor(() => {
    expect(mocks.mockUpdateMutateAsync).toHaveBeenCalled();
  });
  return (mocks.mockUpdateMutateAsync.mock.calls[0]?.[0] ?? null) as Record<
    string,
    unknown
  > | null;
}

describe("scenario editor parameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetByIdData = scenarioDeclaring([]);
    mocks.mockUpdateMutateAsync.mockResolvedValue({ id: "scenario-1" });
    mocks.mockCreateMutateAsync.mockResolvedValue({ id: "scenario-1" });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a scenario that already declares parameters", () => {
    beforeEach(() => {
      mocks.mockGetByIdData = scenarioDeclaring([
        {
          name: "account_tier",
          description: "Which plan the customer is on",
          defaultValue: "gold",
        },
      ]);
    });

    describe("when the editor opens", () => {
      it("names the parameter in the footer next to the labels", async () => {
        renderDrawer();

        const footer = await screen.findByTestId("scenario-parameters-footer");
        expect(
          within(footer).getByTestId("scenario-parameter-chip-account_tier"),
        ).toBeInTheDocument();
      });

      it("keeps the editor out of the form body until it is asked for", () => {
        renderDrawer();

        expect(
          screen.queryByTestId("scenario-parameters-list"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the parameters editor opens", () => {
      it("prefills a row per declaration with its description and default", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);

        expect(screen.getByTestId("scenario-parameter-name-0")).toHaveValue(
          "account_tier",
        );
        expect(
          screen.getByTestId("scenario-parameter-description-0"),
        ).toHaveValue("Which plan the customer is on");
        expect(screen.getByTestId("scenario-parameter-default-0")).toHaveValue(
          "gold",
        );
      });

      /** @scenario "The definitions editor disables the default value for a secret parameter" */
      it("shows a stored secret declaration as secret, with no default to fill", async () => {
        mocks.mockGetByIdData = scenarioDeclaring([
          {
            name: "api_token",
            description: "The tenant API token",
            secret: true,
          },
        ]);
        const user = renderDrawer();

        await openParametersEditor(user);

        expect(screen.getByTestId("scenario-parameter-secret-0")).toBeChecked();
        expect(
          screen.getByTestId("scenario-parameter-default-0"),
        ).toBeDisabled();
      });
    });

    describe("when a row is removed and the scenario is saved", () => {
      it("drops that declaration from the saved scenario", async () => {
        mocks.mockGetByIdData = scenarioDeclaring([
          { name: "region" },
          { name: "account_tier" },
        ]);
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.click(screen.getByTestId("remove-scenario-parameter-0"));
        await clickDone(user);

        expect(await save(user)).toMatchObject({
          parameters: [{ name: "account_tier" }],
        });
      });
    });
  });

  describe("given a scenario that declares none", () => {
    describe("when the parameters editor opens", () => {
      /** @scenario "The parameters editor opens ready to declare the first parameter" */
      it("offers an empty row with an example name in the name field", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);

        const name = screen.getByTestId("scenario-parameter-name-0");
        expect(name).toHaveValue("");
        expect(name).toHaveAttribute("placeholder", "e.g. account_tier");
        expect(
          screen.getByTestId("scenario-parameter-description-0"),
        ).toHaveValue("");
        expect(screen.getByTestId("scenario-parameter-default-0")).toHaveValue(
          "",
        );
      });

      /** @scenario "The parameters editor opens ready to declare the first parameter" */
      it("saves no parameters when the editor closes untouched", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);
        await clickDone(user);

        expect(await save(user)).toMatchObject({ parameters: [] });
      });
    });

    describe("when a parameter is added and the scenario is saved", () => {
      it("carries the new declaration in the saved scenario", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "region",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-description-0"),
          "Which region to run against",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-default-0"),
          "eu-central",
        );
        await clickDone(user);

        expect(await save(user)).toMatchObject({
          parameters: [
            {
              name: "region",
              description: "Which region to run against",
              defaultValue: "eu-central",
            },
          ],
        });
      });

      it("names the new parameter in the footer once the editor closes", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "region",
        );
        await clickDone(user);

        const footer = screen.getByTestId("scenario-parameters-footer");
        expect(
          within(footer).getByTestId("scenario-parameter-chip-region"),
        ).toBeInTheDocument();
      });

      it("keeps a numeric default a number", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "seats",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-default-0"),
          "12",
        );
        await clickDone(user);

        expect(await save(user)).toMatchObject({
          parameters: [{ name: "seats", defaultValue: 12 }],
        });
      });
    });

    describe("when a parameter is marked secret", () => {
      /** @scenario "The definitions editor disables the default value for a secret parameter" */
      it("clears the default value it was given and stops taking one", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "api_token",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-default-0"),
          "abc",
        );
        await user.click(screen.getByTestId("scenario-parameter-secret-0"));

        await waitFor(() => {
          expect(
            screen.getByTestId("scenario-parameter-default-0"),
          ).toHaveValue("");
        });
        expect(
          screen.getByTestId("scenario-parameter-default-0"),
        ).toBeDisabled();
        expect(screen.getByLabelText("Parameter 1 secret")).toBeChecked();
      });

      /** @scenario "The definitions editor disables the default value for a secret parameter" */
      it("saves the declaration as secret and with no default value", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "api_token",
        );
        await user.type(
          screen.getByTestId("scenario-parameter-default-0"),
          "abc",
        );
        await user.click(screen.getByTestId("scenario-parameter-secret-0"));
        await clickDone(user);

        const saved = await save(user);
        expect(saved).toMatchObject({
          parameters: [{ name: "api_token", secret: true }],
        });
        expect(
          (saved?.parameters as Record<string, unknown>[])[0],
        ).not.toHaveProperty("defaultValue");
      });

      it("takes a default value again once it is no longer secret", async () => {
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "api_token",
        );
        await user.click(screen.getByTestId("scenario-parameter-secret-0"));
        await user.click(screen.getByTestId("scenario-parameter-secret-0"));

        await waitFor(() => {
          expect(
            screen.getByTestId("scenario-parameter-default-0"),
          ).not.toBeDisabled();
        });
        expect(screen.getByLabelText("Parameter 1 secret")).not.toBeChecked();
      });
    });

    describe("when a name outside the identifier grammar is typed", () => {
      async function declareBadName() {
        const user = renderDrawer();

        await openParametersEditor(user);
        await user.type(
          screen.getByTestId("scenario-parameter-name-0"),
          "account tier",
        );
        await clickDone(user);
        await user.click(screen.getByTestId("save-button"));
        return user;
      }

      it("refuses the save", async () => {
        await declareBadName();

        await waitFor(() => {
          expect(
            screen.getByTestId("scenario-parameter-error-0"),
          ).toBeInTheDocument();
        });
        expect(mocks.mockUpdateMutateAsync).not.toHaveBeenCalled();
      });

      it("reopens the editor and reports it against the row", async () => {
        await declareBadName();

        const rowError = await screen.findByTestId(
          "scenario-parameter-error-0",
        );
        expect(rowError.textContent).toContain(
          "letters, digits and underscores",
        );
      });

      it("marks the footer group as rejected", async () => {
        await declareBadName();

        await waitFor(() => {
          expect(
            screen.getByTestId("scenario-parameters-footer"),
          ).toHaveAttribute("data-invalid", "true");
        });
      });
    });
  });
});
