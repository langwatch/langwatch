import { type LiquidToken, tokenizeLiquidTemplate } from "@langwatch/prompt-contract";
import type { ReactNode } from "react";

const TAG_COLOR = "var(--chakra-colors-purple-500)";

/**
 * Real fontWeight changes character width in borderless mode's variable-width
 * font (Inter) and breaks caret positioning, so borderless gets a text-shadow
 * "faux bold" that leaves text metrics alone.
 */
function emphasis({ color, borderless }: { color: string; borderless: boolean }) {
  return {
    color,
    fontWeight: borderless ? undefined : 600,
    textShadow: borderless ? `0px 0px 1px ${color}` : undefined,
  };
}

/** The name before any filter pipe or property access. */
function variableNameOf(token: LiquidToken): string {
  const inner = token.value.slice(2, -2).trim();
  return inner.split("|")[0]!.trim().split(".")[0]!.trim();
}

function tokenNode({
  token,
  index,
  isKnownVariable,
  borderless,
}: {
  token: LiquidToken;
  index: number;
  isKnownVariable: (name: string) => boolean;
  borderless: boolean;
}): ReactNode {
  if (token.type === "plain-text") return token.value;
  if (token.type === "variable") {
    const name = variableNameOf(token);
    const isInvalid = name ? !isKnownVariable(name) : true;
    const color = isInvalid ? "var(--chakra-colors-red-500)" : "var(--chakra-colors-blue-500)";
    return (
      <span key={`var-${index}`} style={emphasis({ color, borderless })}>
        {token.value}
      </span>
    );
  }
  return (
    <span key={`tag-${index}`} style={emphasis({ color: TAG_COLOR, borderless })}>
      {token.value}
    </span>
  );
}

/** Highlights Liquid tags and variables for rich-textarea; unknown variables read red. */
export function renderLiquidText({
  text,
  isKnownVariable,
  borderless,
}: {
  text: string;
  isKnownVariable: (name: string) => boolean;
  borderless: boolean;
}): ReactNode[] | null {
  if (!text) return null;
  const tokens = tokenizeLiquidTemplate(text);
  if (tokens.length === 0) return null;
  return tokens.map((token, index) => tokenNode({ token, index, isKnownVariable, borderless }));
}
