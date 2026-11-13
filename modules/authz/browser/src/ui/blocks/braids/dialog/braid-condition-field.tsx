// The condition, coloured, completed and checked as it is typed: a refusal is marked in place with
// its fix, and repeated in one line below. Monaco loads only when the field first shows.

import { type BraidConditionCompileResult } from "@langwatch/authz-contract/braid-condition-compiler";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Alert, Box, Field, Text } from "@langwatch/design-system/primitives";
import { TYPE_SCALE_PX } from "@langwatch/design-system/typography";
import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { lazy, Suspense, useId, useState } from "react";

import {
  defineBraidConditionTheme,
  registerBraidConditionLanguage,
} from "../../../../behavior/braid-condition-monaco.ts";
import {
  type BraidConditionMountedEditor,
  braidConditionThemeName,
  useBraidConditionEditor,
} from "../../../../behavior/use-braid-condition-editor.ts";
import { BRAID_CONDITION_LANGUAGE_ID } from "../../../../model/braids/braid-condition-language.ts";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const LINE_PX = 20;
const PADDING_PX = 6;
const MIN_HEIGHT = LINE_PX + 2 * PADDING_PX;
const MAX_HEIGHT = 4 * LINE_PX + 2 * PADDING_PX;

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  ariaLabel: "Condition",
  placeholder: 'attributes["orchestrator"] == "web"',
  fontFamily: "var(--chakra-fonts-mono)",
  fontSize: TYPE_SCALE_PX.bodySm,
  lineHeight: LINE_PX,
  padding: { top: PADDING_PX, bottom: PADDING_PX },
  minimap: { enabled: false },
  lineNumbers: "off",
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 8,
  lineNumbersMinChars: 0,
  renderLineHighlight: "none",
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: { vertical: "auto", horizontal: "hidden", alwaysConsumeMouseWheel: false },
  scrollBeyondLastLine: false,
  wordWrap: "on",
  automaticLayout: true,
  fixedOverflowWidgets: true,
  contextmenu: false,
  quickSuggestions: { other: true, strings: true, comments: false },
  suggestOnTriggerCharacters: true,
  wordBasedSuggestions: "off",
  tabCompletion: "on",
};

export type BraidConditionFieldProps = {
  value: string;
  onChange: (value: string) => void;
  check: BraidConditionCompileResult;
  ownerName: string;
  readerName: string;
  verified: boolean;
  attributeKeys: readonly { key: string; spanCount: number }[];
  /** Puts the caret in the condition once the editor has loaded, so Edit opens on it. */
  focusOnLoad?: boolean;
};

/** Where a refusal's mark ends: the next space after its offset, or the text's end. */
function refusedEnd({ text, at }: { text: string; at: number }): number {
  const space = text.slice(at).search(/\s/);
  return Math.max(at + 1, space === -1 ? text.length : at + space);
}

function refusalMessage(check: Extract<BraidConditionCompileResult, { ok: false }>): string {
  return `${check.construct[0]?.toUpperCase() ?? ""}${check.construct.slice(1)} isn't supported. ${check.fix}`;
}

function CheckLine({
  check,
  empty,
  touched,
  ownerName,
  readerName,
}: {
  check: BraidConditionCompileResult;
  empty: boolean;
  touched: boolean;
  ownerName: string;
  readerName: string;
}) {
  if (!check.ok) {
    return (
      <Field.ErrorText role="alert" data-testid="braid-condition-check">
        {refusalMessage(check)}
      </Field.ErrorText>
    );
  }
  if (empty && !touched) {
    return (
      <Field.HelperText data-testid="braid-condition-check">
        {`Which ${ownerName} spans to show. Left empty, all of them show.`}
      </Field.HelperText>
    );
  }
  if (empty) {
    return (
      <Alert.Root status="warning" size="sm" data-testid="braid-condition-empty">
        <Alert.Indicator />
        <Alert.Title fontWeight="normal">
          {`No condition: every span from ${ownerName} shows in ${readerName}'s traces.`}
        </Alert.Title>
      </Alert.Root>
    );
  }
  return null;
}

export function BraidConditionField(props: BraidConditionFieldProps) {
  const { colorMode } = useColorMode();
  const dark = colorMode === "dark";
  const [mounted, setMounted] = useState<BraidConditionMountedEditor | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  // The no-condition warning waits until the field has been used, so it never greets a new braid.
  const [touched, setTouched] = useState(false);
  const modelPath = `inmemory://braid-condition/${useId().replaceAll(":", "")}.ottl`;
  const refusal = props.check.ok
    ? undefined
    : {
        at: props.check.at,
        end: refusedEnd({ text: props.value, at: props.check.at }),
        message: refusalMessage(props.check),
      };

  useBraidConditionEditor({
    mounted,
    value: props.value,
    attributeKeys: props.attributeKeys,
    refusal,
    dark,
  });

  const handleMount: OnMount = (mountedEditor, monaco) => {
    const fit = (contentHeight: number) =>
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight)));
    fit(mountedEditor.getContentHeight());
    mountedEditor.onDidContentSizeChange((event) => fit(event.contentHeight));
    mountedEditor.onDidBlurEditorText(() => setTouched(true));
    if (props.focusOnLoad) mountedEditor.focus();
    setMounted({ editor: mountedEditor, monaco });
  };

  return (
    <Field.Root invalid={refusal !== undefined}>
      <Field.Label>
        Condition{" "}
        <Text as="span" color="fg.muted" textStyle="xs" fontWeight="normal">
          OTTL
        </Text>
      </Field.Label>
      <Box
        width="full"
        height={`${height}px`}
        borderWidth="1px"
        borderColor={refusal ? "border.error" : "border"}
        borderRadius="l2"
        overflow="hidden"
        _focusWithin={{ outline: "2px solid", outlineColor: "colorPalette.focusRing" }}
      >
        <Suspense
          fallback={
            <Text paddingX={2} paddingY={1.5} color="fg.muted" textStyle="sm">
              Loading the editor
            </Text>
          }
        >
          <MonacoEditor
            height="100%"
            path={modelPath}
            language={BRAID_CONDITION_LANGUAGE_ID}
            defaultValue={props.value}
            theme={braidConditionThemeName(dark)}
            onChange={(next: string | undefined) => {
              setTouched(true);
              props.onChange(next ?? "");
            }}
            beforeMount={(monaco) => {
              registerBraidConditionLanguage(monaco);
              defineBraidConditionTheme({ monaco, name: braidConditionThemeName(dark), dark });
            }}
            onMount={handleMount}
            options={EDITOR_OPTIONS}
            wrapperProps={{ "data-testid": "braid-condition" }}
          />
        </Suspense>
      </Box>
      <CheckLine
        check={props.check}
        empty={props.value.trim().length === 0}
        touched={touched}
        ownerName={props.ownerName}
        readerName={props.readerName}
      />
    </Field.Root>
  );
}
