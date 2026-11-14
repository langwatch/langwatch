import { Box, type BoxProps } from "@chakra-ui/react";
import type React from "react";

import {
  EXPRESSION_TOKEN_COLOR,
  type ExpressionToken,
  type ExpressionTokenKind,
  tokeniseExpression,
} from "../../expression-tokens.ts";

export {
  EXPRESSION_TOKEN_COLOR,
  type ExpressionToken,
  type ExpressionTokenKind,
  tokeniseExpression,
};

interface HighlightedExpressionProps extends Omit<BoxProps, "children"> {
  /** The expression, for example `attributes["k"] == "v" and Verified("k")`. */
  code: string;
  /**
   * `chip` is one line in a quiet code chip, cut at the end with the whole text as its title.
   * `wrap` flows inside a sentence. `block` stands on its own lines, wrapping between words.
   */
  layout?: "chip" | "wrap" | "block";
  /** `block` only: cut after this many lines, the whole text as its title. */
  maxLines?: number;
}

/** The tokens as coloured spans; joined, their text is exactly `code`. */
export function ExpressionTokens({ tokens }: { tokens: readonly ExpressionToken[] }) {
  return tokens.map((token) =>
    token.kind === "plain" ? (
      token.text
    ) : (
      <Box as="span" key={token.at} color={EXPRESSION_TOKEN_COLOR[token.kind]}>
        {token.text}
      </Box>
    ),
  );
}

const CHIP = {
  display: "inline-block",
  verticalAlign: "middle",
  maxWidth: "full",
  height: "18px",
  paddingX: "4px",
  paddingY: "1px",
  borderRadius: "2px",
  textStyle: "monoSm",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;
const WRAP = {
  display: "inline",
  paddingX: "1",
  paddingY: "2px",
  borderRadius: "xs",
  fontSize: "0.875em",
  whiteSpace: "normal",
  overflowWrap: "break-word",
  boxDecorationBreak: "clone",
} as const;
const BLOCK = {
  display: "block",
  width: "fit-content",
  maxWidth: "full",
  paddingX: "6px",
  paddingY: "2px",
  borderRadius: "xs",
  textStyle: "monoSm",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
} as const;
const LAYOUTS = { chip: CHIP, wrap: WRAP, block: BLOCK } as const;

/**
 * A filter expression read as code, coloured by part: fields, strings, numbers, operators, the
 * joining words and function calls. Ligatures stay off, so `==` reads as two characters.
 */
export function HighlightedExpression({
  code,
  layout = "chip",
  maxLines,
  ...props
}: HighlightedExpressionProps): React.ReactElement {
  const cut = layout === "block" && maxLines !== undefined;
  return (
    <Box
      as="code"
      title={layout === "chip" || cut ? code : undefined}
      fontFamily="mono"
      fontVariantLigatures="none"
      letterSpacing="normal"
      bg="bg.control"
      color="fg"
      {...LAYOUTS[layout]}
      {...(cut ? { lineClamp: maxLines } : {})}
      {...props}
    >
      <ExpressionTokens tokens={tokeniseExpression({ text: code })} />
    </Box>
  );
}
