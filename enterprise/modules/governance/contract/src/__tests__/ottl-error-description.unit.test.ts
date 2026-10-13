import { describe, expect, it } from "vitest";

import { describeOttlError } from "../features/ingestion/ottl.ts";

function describeAt({
  statement,
  col,
  message,
}: {
  statement: string;
  col: number;
  message: string;
}) {
  return describeOttlError({ statement, error: { statementIndex: 0, line: 1, col, message } });
}

describe("describeOttlError", () => {
  it("names what the parser expected and where, not its grammar", () => {
    expect(
      describeAt({
        statement: "set(attributes[ this is not ottl",
        col: 15,
        message: 'statement has invalid syntax: 1:15: unexpected token "[" (expected ")" Key*)',
      }),
    ).toBe("Expected `)` after `attributes`, found `[`");
  });

  it("says a statement ended early", () => {
    expect(
      describeAt({
        statement: 'set(attributes["a"]',
        col: 20,
        message: 'statement has invalid syntax: 1:20: unexpected token "<EOF>" (expected ")")',
      }),
    ).toBe("The statement ends early: expected `)`");
  });

  it("keeps a positionless message, without the parser's prefix", () => {
    expect(
      describeAt({
        statement: "nope(1)",
        col: 0,
        message: 'statement has invalid syntax: undefined function "nope"',
      }),
    ).toBe('Undefined function "nope"');
  });
});
