/**
 * @vitest-environment jsdom
 * The upgrade preview page: a skeleton until the preview answers, then the plan and preflight.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UpgradePreviewView } from "../model/upgrade-view.ts";

const readPreview = vi.hoisted(() => vi.fn());

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      upgrade: {
        status: { useQuery: () => ({ data: void 0, isError: false, error: null }) },
        preview: {
          useQuery: (input: { to: string }) =>
            useQuery({ queryKey: ["preview", input], queryFn: () => readPreview(input) }),
        },
      },
    },
  },
}));
vi.mock("../../../behavior/ops-router.ts", () => ({
  useOpsRouter: () => ({ query: { to: "3.22.0" }, asPath: "", push: vi.fn() }),
}));

import UpgradePreviewScreen from "../ui/sections/upgrade-preview.screen.tsx";

afterEach(cleanup);

const PREVIEW: UpgradePreviewView = {
  installed: "3.21.0",
  plan: {
    outcome: "planned",
    fresh: false,
    notNeeded: [],
    releases: [
      {
        release: "3.22.0",
        virtual: false,
        schema: ["prisma:20261001_add_owner"],
        blocking: [],
        background: ["ops:fill-owner"],
        operator: [],
      },
    ],
  },
  preflight: [
    {
      id: "recent-backup",
      name: "Recent backup",
      outcome: "unchecked",
      detail: null,
      fix: "Take a backup first.",
      docsPath: null,
    },
  ],
};

describe("UpgradePreviewScreen", () => {
  describe("when an operator opens the preview", () => {
    /** @scenario "The preview page shows a skeleton while the preview loads" */
    it("shows a loading skeleton until the preview answers, then the plan", async () => {
      let answer: (preview: UpgradePreviewView) => void = () => {};
      readPreview.mockReturnValueOnce(
        new Promise<UpgradePreviewView>((resolve) => {
          answer = resolve;
        }),
      );
      render(
        <QueryClientProvider client={new QueryClient()}>
          <DesignSystemProvider forcedTheme="light">
            <UpgradePreviewScreen />
          </DesignSystemProvider>
        </QueryClientProvider>,
      );

      expect(screen.getByLabelText("Loading")).toBeTruthy();
      expect(readPreview).toHaveBeenCalledWith({ to: "3.22.0" });

      answer(PREVIEW);

      expect(await screen.findByText("prisma:20261001_add_owner")).toBeTruthy();
      expect(screen.queryByLabelText("Loading")).toBeNull();
      expect(screen.getByTestId("upgrade-preflight-recent-backup").textContent).toContain(
        "Not checked",
      );
    });
  });
});
