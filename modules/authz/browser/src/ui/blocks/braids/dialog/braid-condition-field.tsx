// The condition, coloured, completed and checked as it is typed: a refusal is marked in place with
// its fix, and repeated in one line below. Monaco loads only when the field first shows.

import { type BraidConditionCompileResult } from "@langwatch/authz-contract/braid-condition-compiler";
import { Link } from "@langwatch/browser-host/link";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Alert, Box, Field, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { TYPE_SCALE_PX } from "@langwatch/design-system/typography";
import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { lazy, type ReactNode, Suspense, useEffect, useId, useState } from "react";

import {
  closeSuggestionsOnEscape,
  defineBraidConditionTheme,
  registerBraidConditionLanguage,
} from "../../../../behavior/braid-condition-monaco.ts";
import {
  type BraidConditionMountedEditor,
  braidConditionThemeName,
  useBraidConditionEditor,
} from "../../../../behavior/use-braid-condition-editor.ts";
import { BRAID_CONDITION_LANGUAGE_ID } from "../../../../model/braids/braid-condition-language.ts";
import { BRAIDS_GUIDE_HREF } from "../../../../model/braids/braids.ts";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

const LINE_PX = 20;
const PADDING_PX = 6;
const MIN_HEIGHT = 2 * LINE_PX + 2 * PADDING_PX;
const MAX_HEIGHT = 4 * LINE_PX + 2 * PADDING_PX;
const BORDER_PX = 1;
/** How long typing must pause before a refusal is marked, so a half-typed key is not refused. */
const SETTLE_MS = 600;
const NO_LIGATURES = { fontVariantLigatures: "none", fontFeatureSettings: '"liga" 0, "calt" 0' };

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  ariaLabel: "Condition",
  placeholder: 'attributes["orchestrator"] == "web"',
  fontFamily: "var(--chakra-fonts-mono)",
  fontSize: TYPE_SCALE_PX.bodySm,
  lineHeight: LINE_PX,
  fontLigatures: false,
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
  scrollbar: { vertical: "hidden", horizontal: "hidden", alwaysConsumeMouseWheel: false },
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

/** Scrollbars and the wheel only once the condition outgrows the four lines the field shows. */
function editorOptions(overflowing: boolean): editor.IStandaloneEditorConstructionOptions {
  if (!overflowing)
    return {
      ...EDITOR_OPTIONS,
      scrollbar: { ...EDITOR_OPTIONS.scrollbar, handleMouseWheel: false },
    };
  return { ...EDITOR_OPTIONS, scrollbar: { ...EDITOR_OPTIONS.scrollbar, vertical: "auto" } };
}

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
  /** An option that edits the condition, set directly under the editor. */
  children?: ReactNode;
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
  if (empty && touched) {
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
  const [contentHeight, setContentHeight] = useState(MIN_HEIGHT);
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight));
  // The value a refusal may be marked against: set once typing pauses, or on blur.
  const [settledValue, setSettledValue] = useState(props.value);
  useEffect(() => {
    const timer = setTimeout(() => setSettledValue(props.value), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [props.value]);
  const check: BraidConditionCompileResult =
    settledValue === props.value || props.check.ok ? props.check : { ok: true };
  // The no-condition warning waits until the field has been used, so it never greets a new braid.
  const [touched, setTouched] = useState(false);
  const modelPath = `inmemory://braid-condition/${useId().replaceAll(":", "")}.ottl`;
  const refusal = check.ok
    ? undefined
    : {
        at: check.at,
        end: refusedEnd({ text: props.value, at: check.at }),
        message: refusalMessage(check),
      };

  useBraidConditionEditor({
    mounted,
    value: props.value,
    attributeKeys: props.attributeKeys,
    refusal,
    dark,
  });

  const handleMount: OnMount = (mountedEditor, monaco) => {
    setContentHeight(mountedEditor.getContentHeight());
    mountedEditor.onDidContentSizeChange((event) => setContentHeight(event.contentHeight));
    mountedEditor.onDidBlurEditorText(() => {
      setTouched(true);
      setSettledValue(mountedEditor.getValue());
    });
    mountedEditor.onDidDispose(closeSuggestionsOnEscape(mountedEditor));
    if (props.focusOnLoad) mountedEditor.focus();
    setMounted({ editor: mountedEditor, monaco });
  };

  return (
    <Stack gap={2}>
      <Field.Root invalid={refusal !== undefined}>
        <Stack gap={0.5} width="full" marginBottom={1}>
          <HStack justify="space-between" align="baseline" gap={3}>
            <Field.Label>Condition</Field.Label>
            <HStack gap={1} textStyle="caption" color="fg.muted">
              <Text>OTTL</Text>
              <Text aria-hidden>·</Text>
              <Link href={`${BRAIDS_GUIDE_HREF}#conditions`} isExternal>
                Help
              </Link>
            </HStack>
          </HStack>
          <Text textStyle="caption" color="fg.muted">
            {`Which ${props.ownerName} spans ${props.readerName} sees. Left empty, all of them.`}
          </Text>
        </Stack>
        <Box
          width="full"
          height={`${height + 2 * BORDER_PX}px`}
          borderWidth={`${BORDER_PX}px`}
          borderColor={refusal ? "border.error" : "border"}
          borderRadius="l2"
          overflow="hidden"
          _focusWithin={{ outline: "2px solid", outlineColor: "colorPalette.focusRing" }}
          css={{
            "& .monaco-editor, & .monaco-editor *": NO_LIGATURES,
            // Monaco hangs the list from the caret's line; clear the padding and border below it.
            "& .suggest-widget": { marginTop: `${PADDING_PX + BORDER_PX + 2}px` },
          }}
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
              options={editorOptions(contentHeight > MAX_HEIGHT)}
              wrapperProps={{ "data-testid": "braid-condition" }}
            />
          </Suspense>
        </Box>
        <CheckLine
          check={check}
          empty={props.value.trim().length === 0}
          touched={touched}
          ownerName={props.ownerName}
          readerName={props.readerName}
        />
      </Field.Root>
      {props.children}
    </Stack>
  );
}
