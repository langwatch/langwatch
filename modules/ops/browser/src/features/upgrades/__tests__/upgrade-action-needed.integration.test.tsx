/**
 * @vitest-environment jsdom
 * Home's "Action needed for updates" bar, lent by ops.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let hasAccess = true;
let stepsQuery: { data?: { items: { id: string; status: string }[] }; error?: Error } = {};
const listSteps = vi.fn();

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      upgrade: {
        listSteps: {
          useQuery: (input: unknown, options: unknown) => {
            listSteps(input, options);
            return stepsQuery;
          },
        },
      },
    },
  },
}));
vi.mock("../../../behavior/ops-session.ts", () => ({
  useOpsPermission: () => ({ hasAccess }),
}));
vi.mock("@langwatch/browser-host/link", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { UpgradeActionNeeded } from "../ui/sections/upgrade-action-needed.tsx";

afterEach(() => {
  cleanup();
  listSteps.mockClear();
  hasAccess = true;
  stepsQuery = {};
});

function renderBar() {
  render(
    <DesignSystemProvider forcedTheme="light">
      <UpgradeActionNeeded />
    </DesignSystemProvider>,
  );
}

describe("UpgradeActionNeeded", () => {
  describe("given an unfinished operator step of the running version", () => {
    /** @scenario "Home shows Action needed for updates while an operator step is unfinished" */
    it("shows the bar to an ops:view holder, linking to Ops, Upgrades", () => {
      stepsQuery = {
        data: {
          items: [
            { id: "a", status: "pending" },
            { id: "b", status: "done" },
          ],
        },
      };
      renderBar();

      expect(screen.getByText("Action needed for updates")).toBeTruthy();
      expect(screen.getByRole("link").getAttribute("href")).toBe("/ops/upgrades");
      expect(screen.queryByRole("button", { name: /Done/ })).toBeNull();
    });
  });

  describe("given every operator step is finished, or the read is pending or failed", () => {
    /** @scenario "Home shows no update bar when nothing needs doing" */
    it("draws nothing", () => {
      for (const next of [
        { data: { items: [{ id: "b", status: "done" }] } },
        {},
        { error: new Error("boom") },
      ]) {
        stepsQuery = next;
        renderBar();
        expect(screen.queryByTestId("home-upgrade-action-needed")).toBeNull();
        cleanup();
      }
    });
  });

  describe("given a viewer without ops:view", () => {
    /** @scenario "Home shows no update bar to someone without ops:view" */
    it("draws nothing and does not read the steps", () => {
      hasAccess = false;
      stepsQuery = { data: { items: [{ id: "a", status: "pending" }] } };
      renderBar();

      expect(screen.queryByTestId("home-upgrade-action-needed")).toBeNull();
      expect(listSteps).toHaveBeenCalledWith({ mode: "operator" }, { enabled: false });
    });
  });
});
