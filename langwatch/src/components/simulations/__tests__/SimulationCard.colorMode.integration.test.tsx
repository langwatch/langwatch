/**
 * @vitest-environment jsdom
 *
 * @see specs/suites/simulation-card-color-mode.feature
 */
import { ChakraProvider, defaultSystem, Text } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "@langwatch/contracts/scenarios/enums";
import { SimulationCard } from "../SimulationCard";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<SimulationCard /> completion colors", () => {
  afterEach(cleanup);

  /** @scenario Light mode restores the full-card completion wash */
  it("renders a completed card title in white above the status wash", () => {
    render(
      <SimulationCard
        title="Completed scenario"
        status={ScenarioRunStatus.SUCCESS}
      >
        <Text>Conversation preview</Text>
      </SimulationCard>,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Completed scenario")).toHaveStyle({
      color: "var(--chakra-colors-white)",
    });
  });

  it("keeps an unfinished card title on the normal foreground color", () => {
    render(
      <SimulationCard
        title="Running scenario"
        status={ScenarioRunStatus.RUNNING}
      >
        <Text>Conversation preview</Text>
      </SimulationCard>,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Running scenario")).not.toHaveStyle({
      color: "var(--chakra-colors-white)",
    });
  });
});
