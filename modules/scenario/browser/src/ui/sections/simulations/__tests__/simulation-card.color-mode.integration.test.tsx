/**
 * @vitest-environment jsdom
 *
 * @see specs/suites/simulation-card-color-mode.feature
 */
import { Text } from "@langwatch/design-system/primitives";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SimulationCard } from "../../../elements/suite/runs/simulation-card.tsx";

describe("<SimulationCard /> completion colors", () => {
  afterEach(cleanup);

  /** @scenario Light mode restores the full-card completion wash */
  it("renders a completed card title in white above the status wash", () => {
    renderWithDesignSystem(
      <SimulationCard title="Completed scenario" status={ScenarioRunStatus.SUCCESS}>
        <Text>Conversation preview</Text>
      </SimulationCard>,
    );

    expect(screen.getByText("Completed scenario")).toHaveStyle({
      color: "var(--chakra-colors-white)",
    });
  });

  it("keeps an unfinished card title on the normal foreground color", () => {
    renderWithDesignSystem(
      <SimulationCard title="Running scenario" status={ScenarioRunStatus.RUNNING}>
        <Text>Conversation preview</Text>
      </SimulationCard>,
    );

    expect(screen.getByText("Running scenario")).not.toHaveStyle({
      color: "var(--chakra-colors-white)",
    });
  });
});
