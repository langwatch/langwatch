import { describe, expect, it } from "vitest";

import { mergeDiagnostics } from "../src/unused-directives.mjs";

// Shapes as oxlint 1.85 `-f json` prints them; spans are byte offsets into a.ts.
const span = ({ offset, length, line, column }) => [{ span: { offset, length, line, column } }];
const whole = {
  message: "Unused oxlint-disable directive (no problems were reported).",
  severity: "error",
  filename: "a.ts",
  labels: span({ offset: 100, length: 60, line: 4, column: 1 }),
};
const fromNoConsole = {
  message: "Unused oxlint-disable directive (no problems were reported from no-console).",
  severity: "error",
  filename: "a.ts",
  labels: span({ offset: 141, length: 10, line: 4, column: 42 }),
};
const finding = {
  message: "Unexpected console statement.",
  code: "eslint(no-console)",
  severity: "error",
  filename: "a.ts",
  labels: span({ offset: 300, length: 11, line: 9, column: 1 }),
};

describe("mergeDiagnostics", () => {
  /** @scenario "A disable directive is unused only when no lint process used it" */
  it("keeps a whole-directive report every process makes, once", () => {
    expect(mergeDiagnostics({ reports: [[whole], [whole], [whole]] })).toEqual([whole]);
  });

  /** @scenario "A disable directive is unused only when no lint process used it" */
  it("drops a whole-directive report a process that used the directive did not make", () => {
    expect(mergeDiagnostics({ reports: [[whole], []] })).toEqual([]);
  });

  /** @scenario "A per-rule unused report stands only where no other process used that rule" */
  it("keeps a per-rule report where the other process used none of the directive", () => {
    expect(mergeDiagnostics({ reports: [[fromNoConsole], [whole]] })).toEqual([fromNoConsole]);
  });

  /** @scenario "A per-rule unused report stands only where no other process used that rule" */
  it("drops a per-rule report where another process used that rule", () => {
    expect(mergeDiagnostics({ reports: [[fromNoConsole], [], [whole]] })).toEqual([]);
  });

  it("does not let a whole report in another file cover a per-rule report", () => {
    const elsewhere = { ...whole, filename: "b.ts" };

    expect(mergeDiagnostics({ reports: [[fromNoConsole], [elsewhere]] })).toEqual([]);
  });

  it("passes every process's findings through", () => {
    const other = { ...finding, code: "langwatch(comment-block-size)", message: "Too long." };

    expect(mergeDiagnostics({ reports: [[finding], [other]] })).toEqual([finding, other]);
  });
});
