/**
 * The situation field, with each inline `{ name: value }` declaration tinted.
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { Box, Textarea } from "@langwatch/design-system/primitives";
import type { InlineDeclaration, InlineDeclarationStatus } from "@langwatch/scenario-contract";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import { DIALOG_FIELD_STYLE } from "../../../elements/agent-testing/shared/dialog-fields.tsx";

/**
 * Same look as the prompt editor's `{{ variable }}` (prompt liquid-highlight.tsx):
 * blue for a good one, red for a refused one, faux bold so caret metrics hold.
 * Conflicts take the orange the scenario badges use.
 */
const COLOR: Record<InlineDeclarationStatus["kind"], string> = {
  declared: "var(--chakra-colors-blue-fg)",
  duplicate: "var(--chakra-colors-orange-fg)",
  stored: "var(--chakra-colors-orange-fg)",
  secret: "var(--chakra-colors-red-fg)",
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
      <span
        key={declaration.start}
        style={{
          color: COLOR[declaration.status.kind],
          textShadow: `0px 0px 1px ${COLOR[declaration.status.kind]}`,
        }}
        data-testid="situation-declaration"
        data-status={declaration.status.kind}
      >
        {text.slice(declaration.start, declaration.end)}
      </span>,
    );
    at = declaration.end;
  }
  // The trailing space keeps a last empty line, so the scroll matches the field's.
  nodes.push(`${text.slice(at)} `);
  return nodes;
}

/**
 * A textarea over a mirror of its own text. The mirror lays the text out the
 * same way and colours the declarations; the field itself draws no glyphs.
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
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // A paste or undo can move the field's scroll without a scroll event.
  useLayoutEffect(() => {
    if (mirrorRef.current && fieldRef.current) {
      mirrorRef.current.scrollTop = fieldRef.current.scrollTop;
    }
  }, [value]);

  return (
    <Box position="relative" borderRadius="lg" background="bg.panel">
      <Box
        ref={mirrorRef}
        aria-hidden
        data-testid="case-modal-situation-highlights"
        position="absolute"
        inset={0}
        overflow="hidden"
        // Both reserve the scrollbar's width, so they wrap lines alike.
        css={{ scrollbarGutter: "stable" }}
        pointerEvents="none"
        borderWidth="1px"
        borderColor="transparent"
        paddingX={DIALOG_FIELD_STYLE.paddingX}
        paddingY={DIALOG_FIELD_STYLE.paddingY}
        textStyle={DIALOG_FIELD_STYLE.textStyle}
        whiteSpace="pre-wrap"
        overflowWrap="break-word"
      >
        {highlightedText({ text: value, declarations })}
      </Box>
      <Textarea
        ref={fieldRef}
        {...DIALOG_FIELD_STYLE}
        background="transparent"
        color="transparent"
        caretColor="var(--chakra-colors-fg)"
        position="relative"
        // Inline-block leaves a baseline gap below the field, so the wrapper
        // (and the mirror's inset: 0) ends up taller and scrolls 5px short.
        css={{ display: "block", scrollbarGutter: "stable" }}
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
