import { describe, expect, it } from "vitest";
import { renameWorkspaceReference } from "../src/workspace-package-rename";

describe("workspace package rename", () => {
  it("renames module specifiers without changing comments or ordinary strings", () => {
    const source = `import { Agent } from "@langwatch/agents-contract";
export type { AgentInput } from "@langwatch/agents-contract/input";
const lazy = import("@langwatch/agents-contract");
const description = "@langwatch/agents-contract";
// @langwatch/agents-contract remains historical prose
`;
    expect(
      renameWorkspaceReference({
        file: "example.ts",
        source,
        from: "@langwatch/agents-contract",
        to: "@langwatch/agent-contract",
      }),
    ).toBe(`import { Agent } from "@langwatch/agent-contract";
export type { AgentInput } from "@langwatch/agent-contract/input";
const lazy = import("@langwatch/agent-contract");
const description = "@langwatch/agents-contract";
// @langwatch/agents-contract remains historical prose
`);
  });

  it("renames exact JSON string values without changing prose", () => {
    const source = `{
  "dependencies": { "@langwatch/agents-contract": "workspace:*" },
  "description": "uses @langwatch/agents-contract internally"
}`;
    expect(
      renameWorkspaceReference({
        file: "package.json",
        source,
        from: "@langwatch/agents-contract",
        to: "@langwatch/agent-contract",
      }),
    ).toBe(`{
  "dependencies": { "@langwatch/agent-contract": "workspace:*" },
  "description": "uses @langwatch/agents-contract internally"
}`);
  });

  it("can rename explicitly selected TypeScript string literals", () => {
    expect(
      renameWorkspaceReference({
        file: "catalogue.ts",
        source: 'export const packageName = "@langwatch/agents-contract";',
        from: "@langwatch/agents-contract",
        to: "@langwatch/agent-contract",
        allStringLiterals: true,
      }),
    ).toBe('export const packageName = "@langwatch/agent-contract";');
  });
});
