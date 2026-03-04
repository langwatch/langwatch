/**
 * @vitest-environment jsdom
 *
 * Integration tests for the ScenarioRunDetailDrawer composition.
 * Individual components (ScenarioRunHeader, SimulationConsole, ScenarioRunActions)
 * have their own tests — these verify the drawer assembles them correctly.
 *
 * @see specs/features/scenarios/run-view-side-by-side-layout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScenarioRunStatus, Verdict } from "~/server/scenarios/scenario-event.enums";
import { Drawer } from "../../ui/drawer";
import { ScenarioRunHeader } from "../ScenarioRunHeader";
import { SimulationConsole } from "../simulation-console/SimulationConsole";

const DrawerWrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <Drawer.Root open={true} placement="end">
      <Drawer.Content>{children}</Drawer.Content>
    </Drawer.Root>
  </ChakraProvider>
);

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ScenarioRunDetailDrawer", () => {
  afterEach(cleanup);

  describe("ScenarioRunHeader in drawer context", () => {
    describe("given a failed run", () => {
      it("displays the scenario name and status icon", () => {
        render(
          <ScenarioRunHeader
            name="Echo user request"
            status={ScenarioRunStatus.FAILED}
            copyableIds={[
              { label: "Scenario ID", value: "sc-123" },
            ]}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(screen.getByText("Echo user request")).toBeInTheDocument();
        expect(screen.getByText("Scenario ID: sc-123")).toBeInTheDocument();
      });
    });

    describe("given a run with display title and copyable IDs", () => {
      it("displays the display title with target name", () => {
        render(
          <ScenarioRunHeader
            name="my-agent: Echo user request"
            status={ScenarioRunStatus.FAILED}
            copyableIds={[
              { label: "Scenario ID", value: "sc-123" },
              { label: "Batch Run ID", value: "br-456" },
              { label: "Run ID", value: "sr-789" },
            ]}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(
          screen.getByText("my-agent: Echo user request"),
        ).toBeInTheDocument();
      });

      it("displays copyable IDs below the header", () => {
        render(
          <ScenarioRunHeader
            name="my-agent: Echo user request"
            status={ScenarioRunStatus.FAILED}
            copyableIds={[
              { label: "Scenario ID", value: "sc-123" },
              { label: "Batch Run ID", value: "br-456" },
              { label: "Run ID", value: "sr-789" },
            ]}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(
          screen.getByText("Scenario ID: sc-123"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Batch Run ID: br-456"),
        ).toBeInTheDocument();
        expect(screen.getByText("Run ID: sr-789")).toBeInTheDocument();
      });
    });
  });

  describe("SimulationConsole in drawer context", () => {
    describe("given a completed run with results", () => {
      it("displays the test report with criteria", () => {
        render(
          <SimulationConsole
            results={{
              verdict: Verdict.FAILURE,
              metCriteria: ["Is polite"],
              unmetCriteria: ["Must repeat verbatim"],
              reasoning: "Did not echo.",
            }}
            scenarioName="Echo user request"
            status={ScenarioRunStatus.FAILED}
            durationInMs={6300}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.getByText("=== Scenario Test Report ==="),
        ).toBeInTheDocument();
        expect(screen.getByText(/Must repeat verbatim/)).toBeInTheDocument();
      });
    });

    describe("given a pending run", () => {
      it("displays running status without criteria", () => {
        render(
          <SimulationConsole
            results={null}
            status={ScenarioRunStatus.IN_PROGRESS}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.getByText("=== Scenario Test Report ==="),
        ).toBeInTheDocument();
      });
    });
  });
});
