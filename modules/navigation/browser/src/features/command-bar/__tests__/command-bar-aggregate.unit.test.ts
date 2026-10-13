import { projectNavigation } from "@langwatch/project-contract";
/**
 * Quick Search offers an aggregate project (ADR-177) the pages its navigation
 * shows, Traces alone, and no action that creates data under it.
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it } from "vitest";

import {
  actionCommands,
  filterCommandsByProjectNavigation,
  topLevelNavigationCommands,
} from "../model/command-catalogue.ts";

const CREATE_ACTIONS = [
  "action-new-agent",
  "action-new-evaluation",
  "action-new-prompt",
  "action-new-dataset",
  "action-new-automation",
  "action-new-scenario",
];

const offered = ({ commands, kind }: { commands: typeof actionCommands; kind: string }) =>
  filterCommandsByProjectNavigation({ commands, navigation: projectNavigation(kind) }).map(
    (command) => command.id,
  );

describe("Quick Search on an aggregate project", () => {
  describe("given an aggregate project", () => {
    /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
    it("offers Trace Explorer and settings, as the navigation does", () => {
      const ids = offered({ commands: topLevelNavigationCommands, kind: "aggregate" });

      expect(ids).toContain("nav-traces-v2");
      expect(ids).toContain("nav-settings");
      for (const hidden of [
        "nav-home",
        "nav-analytics",
        "nav-online-evaluations",
        "nav-agent-testing",
        "nav-experiments",
        "nav-annotations",
        "nav-prompts",
        "nav-datasets",
        "nav-automations",
      ]) {
        expect(ids).not.toContain(hidden);
      }
    });

    /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
    it("offers no action that creates data", () => {
      const ids = offered({ commands: actionCommands, kind: "aggregate" });

      for (const create of CREATE_ACTIONS) expect(ids).not.toContain(create);
      expect(ids).toContain("action-invite-member");
    });
  });

  describe("given an ordinary project", () => {
    it("offers Analytics and every create action", () => {
      expect(offered({ commands: topLevelNavigationCommands, kind: "application" })).toContain(
        "nav-analytics",
      );
      const actions = offered({ commands: actionCommands, kind: "application" });
      for (const create of CREATE_ACTIONS) expect(actions).toContain(create);
    });
  });
});
