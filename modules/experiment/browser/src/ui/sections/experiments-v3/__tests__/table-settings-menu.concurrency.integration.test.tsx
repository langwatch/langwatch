import { renderWithDesignSystem } from "@langwatch/design-system/testing";
// @vitest-environment jsdom
/**
 * The run options' concurrency: Auto by default, a picked value sent with the run, and Auto again.
 * @see modules/experiment/specs/experiment-run-dynamic-concurrency.feature
 */
import { buildExecutionRequest, extractPersistedState } from "@langwatch/experiment-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { TableSettingsMenu } from "../table-settings-menu.tsx";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "acme" } }),
}));

/** What the workbench sends when it runs, built from the store as the run hook builds it. */
const runRequest = () => {
  const state = useEvaluationsV3Store.getState();
  return buildExecutionRequest({
    state: {
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      targets: state.targets,
      evaluators: state.evaluators,
    },
    projectId: "project_1",
    scope: { type: "full" },
    concurrency: state.ui.concurrency,
  })?.request;
};

const savedState = () => extractPersistedState(useEvaluationsV3Store.getState());

const shownConcurrency = () => screen.getByTestId("concurrency-value").textContent;

async function openConcurrency() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /run options/i }));
  await user.click(await screen.findByRole("button", { name: /concurrency/i }));
  return user;
}

describe("the run options' concurrency", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a new experiment", () => {
    /** @scenario "A workbench run on Auto names no concurrency, so the dynamic default applies" */
    it("shows Auto, and its run request and saved state name no concurrency", async () => {
      renderWithDesignSystem(<TableSettingsMenu />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /run options/i }));

      expect(shownConcurrency()).toBe("Auto");
      expect(runRequest()).toBeDefined();
      expect(runRequest()).not.toHaveProperty("concurrency");
      expect(savedState()).not.toHaveProperty("concurrency");
    });
  });

  describe("when a concurrency of 4 is picked", () => {
    /** @scenario "A workbench run with a picked concurrency sends it" */
    it("sends and saves 4", async () => {
      renderWithDesignSystem(<TableSettingsMenu />);
      const user = await openConcurrency();

      const input = await screen.findByLabelText("Concurrency");
      await user.type(input, "4{Enter}");

      await waitFor(() => expect(shownConcurrency()).toBe("4"));
      expect(runRequest()?.concurrency).toBe(4);
      expect(savedState().concurrency).toBe(4);
    });
  });

  describe("when Auto is picked after a concurrency of 4", () => {
    /** @scenario "Auto can be picked again after choosing a concurrency" */
    it("shows Auto and sends no concurrency", async () => {
      useEvaluationsV3Store.getState().setConcurrency(4);
      renderWithDesignSystem(<TableSettingsMenu />);
      const user = await openConcurrency();

      await user.click(await screen.findByRole("button", { name: "Auto" }));

      await waitFor(() => expect(shownConcurrency()).toBe("Auto"));
      expect(runRequest()).not.toHaveProperty("concurrency");
      expect(savedState()).not.toHaveProperty("concurrency");
    });
  });
});
