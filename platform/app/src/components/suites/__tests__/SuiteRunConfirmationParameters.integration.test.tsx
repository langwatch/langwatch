/**
 * @vitest-environment jsdom
 *
 * The run confirmation offers the parameters the run plan's scenarios declare,
 * prefilled from their defaults, and sends whatever is typed over them with the
 * run.
 *
 * The hook and the dialog are rendered together, the way the simulations page
 * wires them: the values live in useRunSuite and the dialog only shows them, so
 * neither half proves the behaviour on its own.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulationSuite } from "~/generated/prisma/client";
import { SuiteRunConfirmationDialog } from "@langwatch/suite-web";
import { useRunSuite } from "../useRunSuite";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  scenarios: [] as { id: string; parameters: unknown }[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: { getSuiteRunData: { invalidate: vi.fn() } },
    }),
    suites: {
      run: {
        useMutation: () => ({ mutate: mocks.mutate, isPending: false }),
      },
    },
    scenarios: {
      getAll: {
        useQuery: () => ({ data: mocks.scenarios, isLoading: false }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "test-project" },
  }),
}));

function buildSuite(): SimulationSuite {
  return {
    id: "suite_1",
    name: "Regression Tests",
    scenarioIds: ["scenario_1", "scenario_2"],
    targets: [{ type: "prompt", referenceId: "prompt_1" }],
    repeatCount: 1,
  } as unknown as SimulationSuite;
}

/** Mirrors how SimulationsPage wires the hook to the dialog. */
function RunSuiteHarness() {
  const { requestRun, dialogProps } = useRunSuite();
  return (
    <>
      <button type="button" onClick={() => requestRun(buildSuite())}>
        Open confirmation
      </button>
      <SuiteRunConfirmationDialog {...dialogProps} />
    </>
  );
}

async function openConfirmation() {
  const user = userEvent.setup();
  render(
    <ChakraProvider value={defaultSystem}>
      <RunSuiteHarness />
    </ChakraProvider>,
  );
  await user.click(screen.getByText("Open confirmation"));
  return user;
}

describe("suite run confirmation parameters", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.scenarios = [];
  });

  describe("given a run plan whose scenarios declare parameters", () => {
    describe("when the run confirmation opens", () => {
      /** @scenario "Suite run confirmation prefills parameter values from scenario defaults" */
      it("offers each declared name already filled in with its default", async () => {
        mocks.scenarios = [
          {
            id: "scenario_1",
            parameters: [
              {
                name: "region",
                description: "Which region to run against",
                defaultValue: "eu-central",
              },
            ],
          },
          {
            id: "scenario_2",
            parameters: [{ name: "account_tier", defaultValue: "gold" }],
          },
        ];

        await openConfirmation();

        expect(screen.getByTestId("suite-run-parameter-region")).toHaveValue(
          "eu-central",
        );
        expect(screen.getByTestId("suite-run-parameter-account_tier")).toHaveValue(
          "gold",
        );
      });

      it("offers one input per declared name, unioned across the scenarios", async () => {
        // The description adds a second element for the same parameter. The
        // count below is thus only correct while the tooltip test id stays
        // outside the `suite-run-parameter-` namespace.
        mocks.scenarios = [
          {
            id: "scenario_1",
            parameters: [
              {
                name: "region",
                description: "Which region the run targets",
                defaultValue: "eu-central",
              },
            ],
          },
          {
            id: "scenario_2",
            parameters: [{ name: "region", defaultValue: "us-east" }],
          },
        ];

        await openConfirmation();

        expect(screen.getAllByTestId(/^suite-run-parameter-/)).toHaveLength(1);
        expect(screen.getByTestId("suite-run-parameter-region")).toHaveValue(
          "eu-central",
        );
      });

      it("leaves a name with no declared default empty", async () => {
        mocks.scenarios = [{ id: "scenario_1", parameters: [{ name: "region" }] }];

        await openConfirmation();

        expect(screen.getByTestId("suite-run-parameter-region")).toHaveValue("");
      });

      it("shows nothing when the scenarios declare no parameters", async () => {
        mocks.scenarios = [
          { id: "scenario_1", parameters: null },
          { id: "scenario_2", parameters: [] },
        ];

        await openConfirmation();

        expect(screen.queryByTestId("suite-run-parameters")).toBeNull();
      });
    });

    describe("when a value is changed and the run is confirmed", () => {
      /** @scenario "Suite run confirmation prefills parameter values from scenario defaults" */
      it("runs with the changed value in place of the default", async () => {
        mocks.scenarios = [
          {
            id: "scenario_1",
            parameters: [
              { name: "region", defaultValue: "eu-central" },
              { name: "account_tier", defaultValue: "gold" },
            ],
          },
        ];

        const user = await openConfirmation();
        await user.clear(screen.getByTestId("suite-run-parameter-region"));
        await user.type(screen.getByTestId("suite-run-parameter-region"), "us-east");
        await user.click(screen.getByText("Run 1 Job"));

        expect(mocks.mutate).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "suite_1",
            parameters: { region: "us-east", account_tier: "gold" },
          }),
        );
      });

      it("keeps a typed number a number and a typed boolean a boolean", async () => {
        mocks.scenarios = [
          {
            id: "scenario_1",
            parameters: [{ name: "seats" }, { name: "trial" }],
          },
        ];

        const user = await openConfirmation();
        await user.type(screen.getByTestId("suite-run-parameter-seats"), "12");
        await user.type(screen.getByTestId("suite-run-parameter-trial"), "false");
        await user.click(screen.getByText("Run 1 Job"));

        expect(mocks.mutate).toHaveBeenCalledWith(
          expect.objectContaining({
            parameters: { seats: 12, trial: false },
          }),
        );
      });

      it("omits a name left empty so the run falls back to the declared default", async () => {
        mocks.scenarios = [
          {
            id: "scenario_1",
            parameters: [
              { name: "region", defaultValue: "eu-central" },
              { name: "account_tier" },
            ],
          },
        ];

        const user = await openConfirmation();
        await user.click(screen.getByText("Run 1 Job"));

        expect(mocks.mutate).toHaveBeenCalledWith(
          expect.objectContaining({ parameters: { region: "eu-central" } }),
        );
      });
    });
  });

  describe("given a run plan whose scenarios declare a secret parameter", () => {
    // The secret is declared by the second scenario alone, so the union has to
    // carry the flag across the run for the field to hide anything.
    const scenariosDeclaringASecret = [
      {
        id: "scenario_1",
        parameters: [{ name: "region", defaultValue: "eu-central" }],
      },
      {
        id: "scenario_2",
        parameters: [
          {
            name: "api_token",
            description: "The tenant API token",
            secret: true,
          },
        ],
      },
    ];

    describe("when the run confirmation opens", () => {
      /** @scenario "The run dialog requires a value for every secret parameter" */
      it("hides what is typed for the secret and asks for it empty", async () => {
        mocks.scenarios = scenariosDeclaringASecret;

        await openConfirmation();

        const secret = screen.getByTestId("suite-run-parameter-api_token");
        expect(secret).toHaveAttribute("type", "password");
        expect(secret).toHaveValue("");
        expect(screen.getByTestId("suite-run-parameter-region")).toHaveAttribute(
          "type",
          "text",
        );
      });

      /** @scenario "The run dialog requires a value for every secret parameter" */
      it("holds the run until the secret has a value", async () => {
        mocks.scenarios = scenariosDeclaringASecret;

        const user = await openConfirmation();

        const runButton = screen.getByText("Run 2 Jobs").closest("button");
        expect(runButton).toBeDisabled();
        expect(
          screen.getByTestId("suite-run-parameter-error-api_token"),
        ).toBeInTheDocument();

        await user.type(
          screen.getByTestId("suite-run-parameter-api_token"),
          "tok-live-1",
        );

        expect(runButton).not.toBeDisabled();
        expect(screen.queryByTestId("suite-run-parameter-error-api_token")).toBeNull();
      });
    });

    describe("when the secret is typed and the run is confirmed", () => {
      /** @scenario "The run dialog requires a value for every secret parameter" */
      it("sends the typed value under that name", async () => {
        mocks.scenarios = scenariosDeclaringASecret;

        const user = await openConfirmation();
        await user.type(
          screen.getByTestId("suite-run-parameter-api_token"),
          "tok-live-1",
        );
        await user.click(screen.getByText("Run 2 Jobs"));

        expect(mocks.mutate).toHaveBeenCalledWith(
          expect.objectContaining({
            parameters: { region: "eu-central", api_token: "tok-live-1" },
          }),
        );
      });

      it("keeps a token of digits a string", async () => {
        mocks.scenarios = [
          {
            id: "scenario_1",
            parameters: [{ name: "api_token", secret: true }],
          },
        ];

        const user = await openConfirmation();
        await user.type(screen.getByTestId("suite-run-parameter-api_token"), "12345");
        await user.click(screen.getByText("Run 1 Job"));

        expect(mocks.mutate).toHaveBeenCalledWith(
          expect.objectContaining({ parameters: { api_token: "12345" } }),
        );
      });
    });
  });

  describe("given a run plan whose scenarios declare no parameters", () => {
    describe("when the run is confirmed", () => {
      it("sends no parameters at all", async () => {
        mocks.scenarios = [{ id: "scenario_1", parameters: null }];

        const user = await openConfirmation();
        await user.click(screen.getByText("Run 1 Job"));

        expect(mocks.mutate).toHaveBeenCalledWith(
          expect.objectContaining({ parameters: undefined }),
        );
      });
    });
  });
});
