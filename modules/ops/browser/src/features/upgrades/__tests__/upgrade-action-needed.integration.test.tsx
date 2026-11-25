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
let attention = false;
let stepsQuery: { data?: { items: { id: string; status: string }[] }; error?: Error } = {};
const listSteps = vi.fn();

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      upgrade: {
        attentionNotice: { useQuery: () => ({ data: { show: attention } }) },
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
  attention = false;
  stepsQuery = {};
});

const NOTICE = "LangWatch's last update needs attention. Contact your LangWatch operator.";

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

  describe("given the upgrade attention notice answers show", () => {
    /** @scenario "Home's upgrade notice tells a member to contact their operator" */
    it("tells a member without ops:view to contact their operator, with no link", () => {
      attention = true;
      hasAccess = false;
      renderBar();

      expect(screen.getByText("Action needed for updates")).toBeTruthy();
      expect(screen.getByText(NOTICE)).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    /** @scenario "An operator's upgrade notice on Home links to Ops › Upgrades" */
    it("shows an operator one card that links to Ops, Upgrades", () => {
      attention = true;
      stepsQuery = { data: { items: [{ id: "a", status: "pending" }] } };
      renderBar();

      expect(screen.getAllByText("Action needed for updates")).toHaveLength(1);
      expect(screen.getByRole("link").getAttribute("href")).toBe("/ops/upgrades");
    });
  });

  describe("given the upgrade attention notice has not answered yet", () => {
    /** @scenario "The upgrade notice shows nothing while it loads" */
    it("draws no card", () => {
      hasAccess = false;
      renderBar();

      expect(screen.queryByTestId("home-upgrade-action-needed")).toBeNull();
    });
  });
});
