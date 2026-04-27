/**
 * @vitest-environment node
 *
 * Pin the eval-wizard Code-Execution-Node default template post
 * nlp-go-migration. The wizard reaches this factory whenever a user
 * adds a Code block to a custom evaluator's pipeline; if it ships with
 * `import dspy` again, dogfooders see a contradiction with the rest of
 * the migration (workflow-studio template is plain Python, agent
 * editor is plain Python, but the wizard still imports dspy).
 *
 * Mirrors optimization_studio/__tests__/registry.test.ts and
 * components/agents/__tests__/AgentCodeEditorDrawer.integration.test.tsx —
 * three surfaces, one rule.
 */
import { describe, expect, it } from "vitest";

import { CodeExecutionNodeFactory } from "../code-execution-node.factory";

describe("CodeExecutionNodeFactory default template", () => {
  it("ships without any dspy reference", () => {
    const node = CodeExecutionNodeFactory.build();
    const codeParam = node.data.parameters?.find(
      (p) => p.identifier === "code",
    );
    const value = codeParam?.value as string;

    expect(value).not.toContain("import dspy");
    expect(value).not.toContain("dspy.Module");
    expect(value).not.toContain("(dspy.");
  });

  it("uses a plain Python class with a forward method", () => {
    const node = CodeExecutionNodeFactory.build();
    const codeParam = node.data.parameters?.find(
      (p) => p.identifier === "code",
    );
    const value = codeParam?.value as string;

    expect(value).toMatch(/^class\s+\w+\s*:/m);
    expect(value).toContain("def forward");
  });
});
