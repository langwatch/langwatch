/**
 * @vitest-environment jsdom
 *
 * specs/navigation/drawer-chunk-warmup.feature
 */
import { render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

const { promptListLoads } = vi.hoisted(() => ({
  promptListLoads: { count: 0 },
}));

vi.mock("~/components/scenarios/ScenarioFormDrawer", () => ({
  ScenarioFormDrawerFromUrl: () => <div data-testid="scenario-editor" />,
}));

vi.mock("~/components/prompts/PromptListDrawer", () => {
  promptListLoads.count += 1;
  // The first load fails the way a file that a deploy removed does.
  if (promptListLoads.count === 1) {
    throw new Error("Failed to fetch dynamically imported module");
  }
  return { PromptListDrawer: () => <div data-testid="prompt-list" /> };
});

import { drawers, preloadDrawer } from "../drawerRegistry";

const renderDrawer = (Drawer: React.FC<any>) =>
  render(
    <Suspense fallback={<div data-testid="spinner" />}>
      <Drawer />
    </Suspense>,
  );

describe("preloadDrawer", () => {
  describe("given a drawer whose code is already fetched", () => {
    describe("when it is opened", () => {
      /** @scenario "A warmed drawer opens with no spinner in between" */
      it("renders at once", async () => {
        await preloadDrawer("scenarioEditor");

        renderDrawer(drawers.scenarioEditor);

        expect(screen.getByTestId("scenario-editor")).toBeInTheDocument();
        expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a warm-up that could not fetch the code", () => {
    describe("when the drawer is opened later", () => {
      /** @scenario "A drawer whose warm-up failed can still be opened" */
      it("fetches the code again and opens", async () => {
        await expect(preloadDrawer("promptList")).resolves.toBeUndefined();

        renderDrawer(drawers.promptList);

        expect(screen.getByTestId("spinner")).toBeInTheDocument();
        await waitFor(() =>
          expect(screen.getByTestId("prompt-list")).toBeInTheDocument(),
        );
      });
    });
  });
});
