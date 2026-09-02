/**
 * The chart specification editor.
 *
 * It edits text and reports how much is wrong with it. That is the whole of it:
 * changing a chart is a change to how the result is drawn, never a change to
 * the query, so nothing here can cause the database to be asked anything. The
 * editor holds no query hook, issues no request, and writes nothing anywhere —
 * a specification lives as long as the member is looking at this result and no
 * longer.
 *
 * The problems themselves are rendered by the policy panel beside this editor;
 * what this keeps is the live count, as a status line a screen reader hears
 * without having to find the panel.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import type { editor } from "monaco-editor";
import { lazy, Suspense } from "react";

import type { VegaValidationError } from "../../model/visualization/visualization-types";

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
        role="status"
        paddingX={errors.length > 0 ? 4 : 0}
        paddingY={errors.length > 0 ? 1 : 0}
        borderTopWidth={errors.length > 0 ? "1px" : "0"}
        borderColor="border"
      >
        {errors.length > 0
          ? errors.length === 1
            ? "1 problem to fix"
            : `${errors.length} problems to fix`
          : ""}
      </Text>
    </VStack>
  );
}
