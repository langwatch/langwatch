/**
 * Structural proof that Agent owns its editor presentation and the Scenario and Suite hosts
 * reach it by drawer name.
 * @see modules/agent/specs/package-boundary.feature
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

const MODULES = join(import.meta.dirname, "..", "..", "..", "..");
const AGENT_BROWSER_SRC = join(MODULES, "agent", "browser", "src");

/** The drawers Agent declares, with the component file each loads. */
const AGENT_EDITORS = {
  agentList: "ui/sections/agent-list-drawer.tsx",
  agentHistory: "ui/sections/agent-history-drawer.tsx",
  agentTypeSelector: "ui/sections/agent-type-selector-drawer.tsx",
  agentCodeEditor: "ui/sections/agent-code-editor-drawer.tsx",
  agentHttpEditor: "ui/sections/agent-http-editor-drawer.tsx",
  agentConnectedDetail: "ui/sections/connected-agent-drawer.tsx",
  agentWorkflowEditor: "ui/sections/agent-workflow-editor-drawer.tsx",
  agentWorkflowTargetEditor: "ui/sections/agent-workflow-target-editor-drawer.tsx",
  workflowSelector: "ui/sections/workflow-selector-drawer.tsx",
} as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function hostSources(host: "scenario" | "suite"): string[] {
  return sourceFiles(join(MODULES, host, "browser", "src"));
}

describe("Agent editor ownership", () => {
  describe("when the Agent browser declaration is read", () => {
    /** @scenario "Agent owns reusable editor presentation" */
    it("declares the management screen, history drawer, type selector and every editor, each with its component", () => {
      const declaration = readFileSync(join(AGENT_BROWSER_SRC, "agent.web.ts"), "utf8");

      expect(existsSync(join(AGENT_BROWSER_SRC, "ui/sections/agent-management-screen.tsx"))).toBe(
        true,
      );
      for (const [drawer, file] of Object.entries(AGENT_EDITORS)) {
        expect(declaration, drawer).toMatch(new RegExp(`\\n    ${drawer}: \\{`));
        expect(existsSync(join(AGENT_BROWSER_SRC, file)), file).toBe(true);
      }
    });
  });

  describe("when the Scenario and Suite hosts are read", () => {
    /** @scenario "Agent owns reusable editor presentation" */
    it.each(["scenario", "suite"] as const)(
      "has the %s host hold no second implementation of an Agent editor",
      (host) => {
        const editorFiles = new Set(Object.values(AGENT_EDITORS).map((file) => basename(file)));
        editorFiles.add("http-config-editor.tsx");

        const copies = hostSources(host).filter((file) => editorFiles.has(basename(file)));
        const declaredHere = readFileSync(
          join(MODULES, host, "browser", "src", `${host}.web.ts`),
          "utf8",
        );
        const redeclared = Object.keys(AGENT_EDITORS).filter((drawer) =>
          new RegExp(`\\n    ${drawer}: \\{`).test(declaredHere),
        );
        const reachedInto = hostSources(host).filter((file) =>
          /@langwatch\/agent-browser\/(?!declaration)|\/agent\/browser\/src/.test(
            readFileSync(file, "utf8"),
          ),
        );

        expect(copies).toEqual([]);
        expect(redeclared).toEqual([]);
        expect(reachedInto).toEqual([]);
      },
    );

    /** @scenario "Agent owns reusable editor presentation" */
    it("has the Scenario host open Agent's editors by drawer name", () => {
      const source = hostSources("scenario")
        .map((file) => readFileSync(file, "utf8"))
        .join("\n");

      for (const drawer of [
        "agentTypeSelector",
        "agentHttpEditor",
        "agentCodeEditor",
        "workflowSelector",
      ]) {
        expect(source, drawer).toMatch(new RegExp(`(openDrawer|setFlowCallbacks)\\("${drawer}"`));
      }
    });
  });
});
