import { describe, expect, it, vi } from "vitest";
import { registerJsonSchema, type AutomationMonaco } from "../src/monaco-schemas";

describe("registerJsonSchema", () => {
  it("keeps previously registered editor schemas when adding a model", () => {
    const diagnostics = vi.fn();
    const monaco: AutomationMonaco = {
      languages: {
        json: {
          jsonDefaults: { setDiagnosticsOptions: diagnostics },
        },
      },
    };

    registerJsonSchema(monaco, "file:///automation/conditions.json", {
      title: "conditions",
    });
    registerJsonSchema(monaco, "file:///automation/slack.json", { title: "slack" });

    expect(diagnostics).toHaveBeenLastCalledWith({
      validate: true,
      allowComments: false,
      schemas: [
        {
          uri: "inmemory://schemas/file%3A%2F%2F%2Fautomation%2Fconditions.json.schema.json",
          fileMatch: ["file:///automation/conditions.json"],
          schema: { title: "conditions" },
        },
        {
          uri: "inmemory://schemas/file%3A%2F%2F%2Fautomation%2Fslack.json.schema.json",
          fileMatch: ["file:///automation/slack.json"],
          schema: { title: "slack" },
        },
      ],
    });
  });
});
