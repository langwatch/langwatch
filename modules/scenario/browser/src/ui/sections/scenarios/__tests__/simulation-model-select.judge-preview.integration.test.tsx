/**
 * The scenario judge picker offers LangWatch Judge (preview) where its flag is on, and the user
 * simulator picker never does.
 * @vitest-environment jsdom
 * @see specs/model-providers/judge-default-model.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const flagsOn = new Set<string>();
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: (flag: { name: string }, options: { enabled?: boolean }) => ({
    enabled: options.enabled !== false && flagsOn.has(flag.name),
    isLoading: false,
  }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" }, organization: { id: "org-1" } }),
}));

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [{ provider: "openai", enabled: true, customModels: [] }],
          isLoading: false,
        }),
      },
      getResolvedDefault: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

import { SimulationModelSelect } from "../simulation-model-select.tsx";

afterEach(() => {
  flagsOn.clear();
  cleanup();
});

function optionsOf(featureKey: "scenarios.user_simulator" | "scenarios.judge") {
  renderWithDesignSystem(
    <SimulationModelSelect value={null} onChange={() => undefined} featureKey={featureKey} />,
  );
  return within(screen.getByRole("listbox", { hidden: true })).getAllByRole("option", {
    hidden: true,
  });
}

describe("<SimulationModelSelect/> and LangWatch Judge (preview)", () => {
  /** @scenario "A scenario's judge picker offers LangWatch Judge (preview) where its flag is on" */
  it("lists it first in the judge picker where the flag is on", () => {
    flagsOn.add("release_langwatch_judge_preview");

    const rows = optionsOf("scenarios.judge");

    expect(rows[0]?.dataset.value).toBe("langwatch/judge-preview");
    expect(rows[0]).toHaveTextContent("LangWatch Judge (preview)");
    expect(rows.length).toBeGreaterThan(1);
  });

  /** @scenario "A scenario's judge picker offers LangWatch Judge (preview) where its flag is on" */
  it("does not list it in the user simulator picker", () => {
    flagsOn.add("release_langwatch_judge_preview");

    const values = optionsOf("scenarios.user_simulator").map((row) => row.dataset.value);

    expect(values).not.toContain("langwatch/judge-preview");
  });

  /** @scenario "A scenario's judge picker offers LangWatch Judge (preview) where its flag is on" */
  it("does not list it in the judge picker where the flag is off", () => {
    const values = optionsOf("scenarios.judge").map((row) => row.dataset.value);

    expect(values).not.toContain("langwatch/judge-preview");
    expect(values.length).toBeGreaterThan(0);
  });
});
