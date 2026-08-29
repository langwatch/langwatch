import { describe, expect, it, vi } from "vitest";

import { blankTemplate } from "../templates/blank.template";
import { parseWorkflowImport } from "../workflow-create-dialog";

function workflowFile(contents: string, size = contents.length) {
  return {
    size,
    text: vi.fn(async () => contents),
  };
}

describe("parseWorkflowImport", () => {
  it("returns a valid Studio workflow without changing its fields", async () => {
    const result = await parseWorkflowImport(workflowFile(JSON.stringify(blankTemplate)));

    expect(result).toEqual({ success: true, workflow: blankTemplate });
  });

  it("rejects files larger than five megabytes before reading them", async () => {
    const file = workflowFile("{}", 5 * 1024 * 1024 + 1);

    const result = await parseWorkflowImport(file);

    expect(file.text).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: {
        title: "File too large",
        description: "File size must be less than 5MB",
      },
    });
  });

  it("reports JSON parsing failures", async () => {
    const result = await parseWorkflowImport(workflowFile("{"));

    expect(result).toMatchObject({
      success: false,
      error: { title: "Invalid workflow file" },
    });
  });

  it("reports schema paths for JSON that is not a workflow", async () => {
    const result = await parseWorkflowImport(workflowFile("{}"));

    expect(result).toMatchObject({
      success: false,
      error: { title: "Invalid workflow file" },
    });

    if (!result.success) {
      expect(result.error.description).toContain("nodes");
    }
  });
});
