import { describe, expect, it } from "vitest";

import { plainSource } from "../model/playground-source.ts";

describe("response syntax", () => {
  /** @scenario "Highlight JSON examples without interpreting their content as markup" */
  it("marks syntax while retaining and escaping response data", () => {
    const code = JSON.stringify(
      { message: '<script>alert("x")</script>', count: 12, ready: false },
      null,
      2,
    );
    const source = plainSource({ code });
    const html = source.lines.join("\n");
    expect(source.code).toBe(code);
    expect(html).toContain('class="docs-json-key"');
    expect(html).toContain('class="docs-json-string"');
    expect(html).toContain('class="docs-json-value">12');
    expect(html).toContain('class="docs-json-value">false');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
