/**
 * The chart specification editor.
 *
 * It edits text and reports what is wrong with it. That is the whole of it:
 * changing a chart is a change to how the result is drawn, never a change to
 * the query, so nothing here can cause the database to be asked anything. The
 * editor holds no query hook, issues no request, and writes nothing anywhere —
 * a specification lives as long as the member is looking at this result and no
 * longer.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Box, Button, HStack, Stack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { editor } from "monaco-editor";
import { useId, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import dynamic from "~/utils/compat/next-dynamic";

import type { VegaValidationError } from "../visualization/visualization.types";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading the editor
    </Box>
  ),
});

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
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
   * by the caller on every edit so the list a member reads is never a list from
   * two keystrokes ago.
   */
  errors: readonly VegaValidationError[];
  /** Open on first render. Closed by default: the chart is the point. */
  defaultOpen?: boolean;
}

export function VegaLiteSpecEditor({
  specText,
  onSpecTextChange,
  errors,
  defaultOpen = false,
}: VegaLiteSpecEditorProps) {
  const { colorMode } = useColorMode();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <VStack align="stretch" gap={2} data-testid="vega-spec-editor">
      <HStack gap={2}>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          data-testid="vega-spec-editor-toggle"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Chart specification
        </Button>
        {errors.length > 0 && (
          <Text fontSize="12px" color="fg.muted" role="status">
            {errors.length === 1
              ? "1 problem to fix"
              : `${errors.length} problems to fix`}
          </Text>
        )}
      </HStack>

      {open && (
        <Stack gap={2} id={panelId}>
          <Box
            height="260px"
            borderWidth="1px"
            borderColor="border"
            borderRadius="8px"
            overflow="hidden"
          >
            <MonacoEditor
              height="100%"
              language="json"
              value={specText}
              theme={colorMode === "dark" ? "vs-dark" : "vs"}
              onChange={(value: string | undefined) =>
                onSpecTextChange(value ?? "")
              }
              options={EDITOR_OPTIONS}
            />
          </Box>

          {errors.length > 0 && (
            <Stack gap={1} data-testid="vega-spec-editor-problems">
              {errors.map((error, index) => (
                <Text
                  key={`${error.rule}-${error.path}-${index}`}
                  fontSize="12.5px"
                  color="fg.muted"
                  data-error-code={error.code}
                >
                  {error.path} — {error.message}
                </Text>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </VStack>
  );
}
