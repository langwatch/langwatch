/**
 * `langwatch agent list --wait-online ACME checkout` is a name with a space
 * passed bare. Commander refuses the stray word; the refusal has to say why.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
import { describe, expect, it } from "vitest";

import { QUOTED_NAME_HINT, withQuotedNameHint } from "../quoted-name-hint";

describe("withQuotedNameHint()", () => {
  /** @scenario "A name with spaces passed bare is told to quote it" */
  it("adds the quoting hint under commander's too-many-arguments line", () => {
    const line =
      "error: too many arguments for 'list'. Expected 0 arguments but got 1: checkout.\n";
    expect(withQuotedNameHint(line)).toBe(`${line.trimEnd()}\n${QUOTED_NAME_HINT}\n`);
  });

  it("leaves every other error line alone", () => {
    const line = "error: unknown option '--wait'\n";
    expect(withQuotedNameHint(line)).toBe(line);
  });
});
