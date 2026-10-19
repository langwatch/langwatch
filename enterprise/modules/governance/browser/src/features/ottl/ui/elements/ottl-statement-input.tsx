// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box, Textarea } from "@langwatch/design-system/primitives";
import type { OttlValidationError } from "@langwatch/enterprise-governance-contract";

import { type OttlTokenKind, ottlSegments } from "../../model/ottl-syntax.ts";

const TOKEN_COLOR: Record<OttlTokenKind, string> = {
  function: "blue.fg",
  path: "teal.fg",
  string: "green.fg",
  number: "orange.fg",
  keyword: "red.fg",
  literal: "orange.fg",
  operator: "fg.muted",
  punctuation: "fg.muted",
  text: "fg",
};

/** Both layers share these, so the coloured text sits exactly under the typed text. */
const SHARED_TEXT = {
  gridArea: "1 / 1",
  margin: 0,
  paddingX: 2,
  paddingY: 1.5,
  fontFamily: "mono",
  fontSize: "xs",
  lineHeight: "1.6",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
} as const;

/**
 * One OTTL statement, coloured as it is typed: a transparent textarea over a highlighted copy,
 * growing with its text. The parser's error range gets a red squiggle; the message is on hover.
 */
export function OttlStatementInput({
  value,
  onChange,
  placeholder,
  error,
  errorMessage,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  error: OttlValidationError | null;
  errorMessage: string | null;
}) {
  const segments = ottlSegments({ text: value, error });

  return (
    <Box
      display="grid"
      flex={1}
      minWidth={0}
      borderWidth="1px"
      borderRadius="md"
      borderColor={error ? "border.error" : "border"}
      backgroundColor="bg.panel"
      _focusWithin={{ borderColor: error ? "border.error" : "border.emphasized" }}
    >
      <Box {...SHARED_TEXT} aria-hidden="true" pointerEvents="none" data-testid="ottl-highlight">
        {segments.map((segment, i) => (
          <Box
            as="span"
            key={i}
            color={TOKEN_COLOR[segment.kind]}
            {...(segment.isError && {
              textDecorationLine: "underline",
              textDecorationStyle: "wavy",
              textDecorationColor: "fg.error",
              textUnderlineOffset: "3px",
              "data-ottl-error": "",
            })}
          >
            {segment.text}
          </Box>
        ))}
        {/* Keeps a trailing newline's height, which the textarea grows into. */}{" "}
      </Box>
      <Textarea
        {...SHARED_TEXT}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        title={errorMessage ?? undefined}
        color="transparent"
        caretColor="fg"
        backgroundColor="transparent"
        border="none"
        borderRadius="md"
        minHeight={0}
        height="full"
        resize="none"
        overflow="hidden"
        outline="none"
        boxShadow="none"
        _focusVisible={{ outline: "none", boxShadow: "none" }}
        _placeholder={{ color: "fg.subtle" }}
      />
    </Box>
  );
}
