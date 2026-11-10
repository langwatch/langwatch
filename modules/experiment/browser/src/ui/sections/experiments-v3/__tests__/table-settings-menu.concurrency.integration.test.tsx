import { renderWithDesignSystem } from "@langwatch/design-system/testing";
// @vitest-environment jsdom
/**
 * The run options' concurrency: Auto by default, a picked value sent with the run, and Auto again.
 * @see modules/experiment/specs/experiment-run-dynamic-concurrency.feature
 */
import { extractPersistedState } from "@langwatch/experiment-contract";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { useExecuteEvaluation } from "../../../../behavior/experiments-v3/use-execute-evaluation.ts";
import { TableSettingsMenu } from "../table-settings-menu.tsx";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "acme" } }),
}));

const sentPayloads: unknown[] = [];
vi.mock("@langwatch/browser-host/fetch-sse", () => ({
  fetchSSE: async ({ payload }: { payload: unknown }) => {
    sentPayloads.push(payload);
  },
}));

/** What the workbench sends when it runs: the real run hook's request, caught at the wire. */
const runRequest = async () => {
  const { result, unmount } = renderHook(() => useExecuteEvaluation());
  await act(() => result.current.execute());
  unmount();
  return sentPayloads.at(-1);
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
    sentPayloads.length = 0;
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
      const request = await runRequest();
      expect(request).toBeDefined();
      expect(request).not.toHaveProperty("concurrency");
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
      expect(await runRequest()).toMatchObject({ concurrency: 4 });
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
      expect(await runRequest()).not.toHaveProperty("concurrency");
      expect(savedState()).not.toHaveProperty("concurrency");
    });
  });
});
