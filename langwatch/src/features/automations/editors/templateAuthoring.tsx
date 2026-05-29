import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import * as React from "react";
import dynamic from "~/utils/compat/next-dynamic";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";
import {
  clearLiquidMarkers,
  LIQUID_JSON_LANGUAGE_ID,
  LIQUID_LANGUAGE_ID,
  type MonacoTextModel,
  registerLiquidLanguage,
  setupLiquidJsonSchema,
  validateLiquidModel,
  type VariableInfo,
} from "./liquidMonaco";
import { useMonacoTheme } from "./useMonacoTheme";

export type { VariableInfo };

/**
 * Building blocks shared by every notification config stage (email subject,
 * email body, Slack template): a Monaco Liquid editor with autocomplete +
 * unknown-variable validation, and a "using default" header with Reset.
 * The heavyweight preview panels (email iframe, Block Kit chrome,
 * variable reference, example data) were retired in favour of an info-icon
 * pip next to "Preview" plus a tooltipped `VariableInfoIcon` on each
 * field header.
 */

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

export interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export function FieldHeader({
  label,
  usingDefault,
  onReset,
  trailing,
}: {
  label: string;
  usingDefault: boolean;
  onReset: () => void;
  /** Optional element rendered next to the label — used by template fields
   *  to slot a `VariableInfoIcon`. Keeps the row chrome out of this primitive. */
  trailing?: React.ReactNode;
}) {
  return (
    <HStack gap={2}>
      <Text textStyle="sm" fontWeight="semibold">
        {label}
      </Text>
      {trailing}
      {usingDefault ? (
        <Badge size="sm" colorPalette="gray">
          Using default
        </Badge>
      ) : (
        <Button size="xs" variant="ghost" onClick={onReset}>
          Reset to default
        </Button>
      )}
    </HStack>
  );
}

function defineMonokai(monaco: Monaco) {
  monaco.editor.defineTheme(
    "monokai",
    monokaiTheme as Parameters<typeof monaco.editor.defineTheme>[1],
  );
}

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: "on" as const,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: "off" as const,
  tabSize: 2,
  padding: { top: 12 },
};

export function LiquidEditor({
  value,
  onChange,
  variables,
  language = LIQUID_LANGUAGE_ID,
  height = "200px",
  jsonSchema,
  jsonSchemaShadowUri,
}: {
  value: string;
  onChange: (value: string) => void;
  variables: VariableInfo[];
  /** "liquid" (default) for regular templates, "liquid-json" for slack
   *  block_kit (JSON whose string values carry Liquid). */
  language?: string;
  height?: string;
  /** Optional JSON Schema to validate the source against. Liquid spans are
   *  stripped to same-length placeholders before validation, so any markers
   *  Monaco's JSON service produces map back 1:1 onto the editor. Pass with
   *  `jsonSchemaShadowUri` — a stable per-editor URI. */
  jsonSchema?: object;
  jsonSchemaShadowUri?: string;
}) {
  const isLiquid =
    language === LIQUID_LANGUAGE_ID || language === LIQUID_JSON_LANGUAGE_ID;
  const theme = useMonacoTheme();
  const monacoRef = useRef<Monaco | null>(null);
  const modelRef = useRef<MonacoTextModel | null>(null);
  const changeSubscription = useRef<{ dispose: () => void } | null>(null);
  const schemaSubscription = useRef<{ dispose: () => void } | null>(null);

  useEffect(
    () => () => {
      changeSubscription.current?.dispose();
      schemaSubscription.current?.dispose();
      if (monacoRef.current && modelRef.current) {
        clearLiquidMarkers(monacoRef.current, modelRef.current);
      }
    },
    [],
  );

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    const model = editor.getModel();
    modelRef.current = model;
    if (isLiquid && model) validateLiquidModel(monaco, model, variables);
    if (!isLiquid) return;
    changeSubscription.current = editor.onDidChangeModelContent(() => {
      const current = editor.getModel();
      if (current) validateLiquidModel(monaco, current, variables);
    });
    if (jsonSchema && jsonSchemaShadowUri && model) {
      schemaSubscription.current = setupLiquidJsonSchema({
        monaco,
        realModel: model,
        schema: jsonSchema,
        shadowUri: jsonSchemaShadowUri,
      });
    }
  };

  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
      height={height}
      background={theme === "monokai" ? "#272822" : "white"}
    >
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        theme={theme}
        beforeMount={(monaco: Monaco) => {
          defineMonokai(monaco);
          registerLiquidLanguage(monaco, variables);
        }}
        onMount={onMount}
        onChange={(next: string | undefined) => onChange(next ?? "")}
        options={editorOptions}
      />
    </Box>
  );
}

