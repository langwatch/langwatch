/**
 * The situation field, with each inline `{ name: value }` declaration tinted.
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { Box, chakra, Textarea } from "@langwatch/design-system/primitives";
import type { InlineDeclaration, InlineDeclarationStatus } from "@langwatch/scenario-contract";
import { type ReactNode, useRef } from "react";

import { DIALOG_FIELD_STYLE } from "../../../elements/agent-testing/shared/dialog-fields.tsx";

/** The tint a declaration takes: plain, overridden or twice declared, refused. */
const TINT: Record<InlineDeclarationStatus["kind"], string> = {
  declared: "blue.subtle",
  duplicate: "orange.subtle",
  stored: "orange.subtle",
  secret: "red.subtle",
};

/** The situation cut into plain runs and tinted declarations, in order. */
function highlightedText({
  text,
  declarations,
}: {
  text: string;
  declarations: readonly InlineDeclaration[];
}): ReactNode[] {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const declaration of declarations) {
    nodes.push(text.slice(at, declaration.start));
    nodes.push(
      <chakra.mark
        key={declaration.start}
        bg={TINT[declaration.status.kind]}
        color="transparent"
        borderRadius="sm"
        data-testid="situation-declaration"
        data-status={declaration.status.kind}
      >
        {text.slice(declaration.start, declaration.end)}
      </chakra.mark>,
    );
    at = declaration.end;
  }
  // The trailing space keeps a last empty line, so the scroll matches the field's.
  nodes.push(`${text.slice(at)} `);
  return nodes;
}

/**
 * A textarea over a mirror of its own text. The mirror lays the text out the
 * same way, invisibly, and tints the declarations behind the real glyphs.
 */
export function SituationInput({
  value,
  onChange,
  declarations,
  invalid,
  minHeight,
  maxHeight,
}: {
  value: string;
  onChange: (value: string) => void;
  declarations: readonly InlineDeclaration[];
  invalid: boolean;
  minHeight: string;
  maxHeight: string;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  return (
    <Box position="relative" borderRadius="lg" background="bg.panel">
      <Box
        ref={mirrorRef}
        aria-hidden
        data-testid="case-modal-situation-highlights"
        position="absolute"
        inset={0}
        overflow="hidden"
        pointerEvents="none"
        borderWidth="1px"
        borderColor="transparent"
        paddingX={DIALOG_FIELD_STYLE.paddingX}
        paddingY={DIALOG_FIELD_STYLE.paddingY}
        textStyle={DIALOG_FIELD_STYLE.textStyle}
        color="transparent"
        whiteSpace="pre-wrap"
        overflowWrap="break-word"
      >
        {highlightedText({ text: value, declarations })}
      </Box>
      <Textarea
        {...DIALOG_FIELD_STYLE}
        background="transparent"
        position="relative"
        autoresize
        resize="none"
        rows={2}
        minHeight={minHeight}
        maxHeight={maxHeight}
        aria-label="Situation"
        aria-invalid={invalid}
        data-testid="case-modal-situation-input"
        placeholder="The customer is on day three of waiting for a refund and threatens to charge back."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
    </Box>
  );
}
