/**
 * `--project` is declared over the finished command tree, so this suite is
 * what makes "a new command cannot forget it" true rather than aspirational.
 *
 * The whole `instant-eval` family shipped with no `--project` because the flag
 * had been added a family at a time and that family was written later. Nothing
 * failed when it was left out. Now a leaf that is neither marked as running
 * inside a project nor listed as one that does not fails here, by name.
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { buildProgram } from "../program";
import {
  COMMANDS_WITH_OWN_PROJECT_FLAG,
  COMMANDS_WITHOUT_PROJECT,
  commandPath,
  isProjectScoped,
  leafCommands,
  projectSelectorOf,
} from "../utils/projectOption";

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant,
// which no test runner defines (see help-topic.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

const tree = () => buildProgram({ bin: "langwatch" });

const leafAt = (program: Command, path: string): Command => {
  const found = leafCommands(program).find(
    (leaf) => commandPath(leaf) === path,
  );
  expect(found, `no leaf command "${path}" in the tree`).toBeDefined();
  return found as Command;
};

const declaresProject = (cmd: Command): boolean =>
  cmd.options.some((option) => option.long === "--project");

describe("given the command tree the CLI runs", () => {
  /** @scenario "a command that resolves project credentials accepts --project" */
  it("declares --project on every command that runs inside a project", () => {
    const missing = leafCommands(tree())
      .map(commandPath)
      .filter(
        (path) =>
          !(path in COMMANDS_WITHOUT_PROJECT) &&
          !(path in COMMANDS_WITH_OWN_PROJECT_FLAG),
      )
      .filter((path) => !declaresProject(leafAt(tree(), path)));

    expect(missing).toEqual([]);
  });

  it("covers the whole instant-eval family, the one this was written for", () => {
    const program = tree();
    const family = leafCommands(program)
      .map(commandPath)
      .filter((path) => path.startsWith("instant-eval "));

    expect(family.length).toBeGreaterThan(0);
    for (const path of family) {
      expect(declaresProject(leafAt(program, path)), path).toBe(true);
      expect(isProjectScoped(leafAt(program, path)), path).toBe(true);
    }
  });

  /** @scenario "a command that never runs inside a project does not take --project" */
  it("leaves a command that never runs inside a project without the flag", () => {
    const program = tree();
    const local = leafAt(program, "config get");

    expect(declaresProject(local)).toBe(false);
    expect(isProjectScoped(local)).toBe(false);
    expect(COMMANDS_WITHOUT_PROJECT["config get"]).toContain("this machine");
  });

  it("records a reason for every command it exempts", () => {
    const entries = [
      ...Object.entries(COMMANDS_WITHOUT_PROJECT),
      ...Object.entries(COMMANDS_WITH_OWN_PROJECT_FLAG),
    ];
    for (const [path, reason] of entries) {
      expect(reason.trim(), path).not.toBe("");
    }
  });

  it("names only commands that exist, so a rename cannot leave a stale exemption", () => {
    const paths = new Set(leafCommands(tree()).map(commandPath));
    const stale = [
      ...Object.keys(COMMANDS_WITHOUT_PROJECT),
      ...Object.keys(COMMANDS_WITH_OWN_PROJECT_FLAG),
    ].filter((path) => !paths.has(path));

    expect(stale).toEqual([]);
  });
});

describe("when a command carries its own --project meaning something else", () => {
  /** @scenario "a command with its own --project keeps its own meaning" */
  it("does not read login's --project as the credential's target", () => {
    const login = leafAt(tree(), "login");

    expect(declaresProject(login)).toBe(true);
    expect(isProjectScoped(login)).toBe(false);
    expect(projectSelectorOf(login)).toBeUndefined();
  });

  it("keeps the spend-events filter out of the credential's target", () => {
    const list = leafAt(tree(), "spend-events list");

    expect(declaresProject(list)).toBe(true);
    expect(isProjectScoped(list)).toBe(false);
  });
});

describe("when a project-scoped command is given --project", () => {
  /** @scenario "the flag reaches the credential resolver without the command passing it" */
  it("reads the selector off the command the hook is about to run", () => {
    const run = leafAt(tree(), "instant-eval run");
    run.setOptionValue("project", "checkout-agent");

    expect(projectSelectorOf(run)).toBe("checkout-agent");
  });

  it("reads nothing from a blank value, so an empty flag is not a selector", () => {
    const run = leafAt(tree(), "instant-eval run");
    run.setOptionValue("project", "   ");

    expect(projectSelectorOf(run)).toBeUndefined();
  });
});
