/**
 * The chart specification editor: edits text and reports how much is
 * wrong, never touching the query or database. The problems render in
 * the policy panel; this keeps the live count as a screen-reader status line.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import type { VegaValidationError } from "@langwatch/analytics-contract/visualization";
import type { editor } from "monaco-editor";
import { lazy, Suspense } from "react";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: "on",
  folding: true,
};

export interface VegaLiteSpecEditorProps {
  specText: string;
  onSpecTextChange: (specText: string) => void;
  /**
   * Everything wrong with the specification as it currently stands, recomputed
   * by the caller on every edit so the count a member hears is never a count
   * from two keystrokes ago.
   */
  errors: readonly VegaValidationError[];
}

export function VegaLiteSpecEditor({
  specText,
  onSpecTextChange,
  errors,
}: VegaLiteSpecEditorProps) {
  const problemCountLabel =
    errors.length === 1 ? "1 problem to fix" : `${errors.length} problems to fix`;
  const problemsLabel = errors.length > 0 ? problemCountLabel : "";

  return (
    <VStack align="stretch" gap={0} height="full" minHeight="240px" data-testid="vega-spec-editor">
      <Box flex="1" minHeight="200px">
        <Suspense
          fallback={
            <Box padding={4} color="fg.muted">
              Loading the editor
            </Box>
          }
        >
          <MonacoEditor
            height="100%"
            language="json"
            value={specText}
            theme="vs"
            onChange={(value: string | undefined) => onSpecTextChange(value ?? "")}
            options={EDITOR_OPTIONS}
          />
        </Suspense>
      </Box>
      <Text
        fontSize="12px"
        color="fg.muted"
        as="output"
        display="block"
        paddingX={errors.length > 0 ? 4 : 0}
        paddingY={errors.length > 0 ? 1 : 0}
        borderTopWidth={errors.length > 0 ? "1px" : "0"}
        borderColor="border"
      >
        {problemsLabel}
      </Text>
    </VStack>
  );
}
