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
   * `chip` is one line in a quiet code chip, cut at the end with the whole text as its title,
   * for tables. `wrap` flows inside a sentence and breaks between words.
   */
  layout?: "chip" | "wrap";
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

/**
 * A filter expression read as code, coloured by part: fields, strings, numbers, operators, the
 * joining words and function calls. Ligatures stay off, so `==` reads as two characters.
 */
export function HighlightedExpression({
  code,
  layout = "chip",
  ...props
}: HighlightedExpressionProps): React.ReactElement {
  return (
    <Box
      as="code"
      title={layout === "chip" ? code : undefined}
      fontFamily="mono"
      fontVariantLigatures="none"
      letterSpacing="normal"
      bg="bg.control"
      color="fg"
      {...(layout === "chip" ? CHIP : WRAP)}
      {...props}
    >
      <ExpressionTokens tokens={tokeniseExpression({ text: code })} />
    </Box>
  );
}
