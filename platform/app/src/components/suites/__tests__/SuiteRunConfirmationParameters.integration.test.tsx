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
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiteRunConfirmationDialog } from "../SuiteRunConfirmationDialog";
import { useRunSuite } from "../useRunSuite";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  scenarios: [] as { id: string; parameters: unknown }[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
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
        expect(
          screen.getByTestId("suite-run-parameter-account_tier"),
        ).toHaveValue("gold");
      });

      it("offers one input per declared name, unioned across the scenarios", async () => {
        // The description matters: it renders a second element for the same
        // parameter, so the count below only stays honest while the tooltip
        // sits outside the `suite-run-parameter-` namespace.
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
        mocks.scenarios = [
          { id: "scenario_1", parameters: [{ name: "region" }] },
        ];

        await openConfirmation();

        expect(screen.getByTestId("suite-run-parameter-region")).toHaveValue(
          "",
        );
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
        await user.type(
          screen.getByTestId("suite-run-parameter-region"),
          "us-east",
        );
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
        await user.type(
          screen.getByTestId("suite-run-parameter-trial"),
          "false",
        );
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
