import { Code, Text } from "@langwatch/design-system/primitives";

import { tokenizeRegex, type RegexTokenKind } from "../../model/regex-rule.ts";

const KIND_COLOR: Record<RegexTokenKind, string | undefined> = {
  group: "purple.fg",
  class: "blue.fg",
  anchor: "red.fg",
  quantifier: "orange.fg",
  escape: "teal.fg",
  literal: undefined,
};

/** A regex in code style with its groups, classes, anchors, quantifiers and escapes coloured. */
export function RegexHighlight({ pattern }: { pattern: string }) {
  return (
    <Code truncate maxWidth="220px">
      {tokenizeRegex(pattern).map((token, index) => (
        <Text as="span" key={index} color={KIND_COLOR[token.kind]} data-kind={token.kind}>
          {token.text}
        </Text>
      ))}
    </Code>
  );
}
