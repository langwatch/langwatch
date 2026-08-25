import { Box, Button, HStack, Kbd, Spinner, Text } from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import type { LangWatchQLParameterValue } from "../logic/lwql-request-state";
import {
  isLangWatchQLResultStale,
  type LangWatchQLActionLabel,
  type LangWatchQLRequestState,
  type LangWatchQLTimeWindowValues,
} from "../logic/lwql-request-state";
import {
  type LangWatchQLEditorMarker,
  LWQL_PARAMETER_MISSING_CODE,
  LWQL_RESERVED_PARAMETER_SUPPLIED_CODE,
  lwqlEditorMarkers,
  readLangWatchQLFailure,
} from "../logic/lwql-failure";
import type { LangWatchQLSchemaModel } from "../logic/lwql-schema-model";
import {
  LangWatchQLParametersEditor,
  type LangWatchQLParametersChange,
} from "./langwatch-ql-parameters-editor";
import { LangWatchQLEditor } from "./langwatch-ql-editor";
import {
  LangWatchQLResultPane,
  type LangWatchQLResultView,
} from "./langwatch-ql-result-pane";
import { LangWatchQLSchemaBrowser } from "./langwatch-ql-schema-browser";
import { LangWatchQLTimeWindowEditor } from "./langwatch-ql-time-window-editor";

export interface LangWatchQLWorkbenchQuery {
  readonly state: LangWatchQLRequestState;
  readonly actionLabel: LangWatchQLActionLabel;
  readonly setSql: (sql: string) => void;
  readonly setParameters: (
    parameters: Readonly<Record<string, LangWatchQLParameterValue>>,
  ) => void;
  readonly setTimeWindow: (timeWindow: LangWatchQLTimeWindowValues | undefined) => void;
  readonly runQuery: () => void;
  readonly cancelQuery: () => void;
}

export interface LangWatchQLWorkbenchSchema {
  readonly model: LangWatchQLSchemaModel;
  readonly isLoading: boolean;
  readonly error: unknown;
}

export interface LangWatchQLWorkbenchDraft {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
  readonly vegaLiteSpec?: Record<string, unknown>;
}

export interface LangWatchQLWorkbenchChart {
  readonly view: LangWatchQLResultView;
  readonly openSpecification: () => void;
  readonly result: Extract<
    LangWatchQLRequestState["outcome"],
    { kind: "result" }
  >["result"];
  readonly submittedLabel: string;
  readonly editedSpecText: string | null;
  readonly onEditedSpecTextChange: (text: string | null) => void;
}

/**
 * Portable workbench composition. The host supplies transport state/actions,
 * its error treatment, and the lazily-loaded chart as narrow render ports.
 */
export interface LangWatchQLWorkbenchProps {
  readonly schema: LangWatchQLWorkbenchSchema;
  readonly query: LangWatchQLWorkbenchQuery;
  readonly pageTimeWindow: LangWatchQLTimeWindowValues;
  readonly editorTheme?: "vs" | "vs-dark";
  readonly initialParameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  readonly openedRevision?: number;
  readonly openedSpecText?: string;
  readonly renderChart: (chart: LangWatchQLWorkbenchChart) => ReactNode;
  readonly renderToolbar?: (input: {
    canSave: boolean;
    draft: LangWatchQLWorkbenchDraft;
  }) => ReactNode;
  readonly renderError?: (error: unknown, fallbackTitle: string) => ReactNode;
}

interface FailureView {
  readonly markers: readonly LangWatchQLEditorMarker[];
  readonly missingParameters: readonly string[];
  readonly reservedParameters: readonly string[];
}

const NO_FAILURE_VIEW: FailureView = {
  markers: [],
  missingParameters: [],
  reservedParameters: [],
};

function failureView(state: LangWatchQLRequestState): FailureView {
  if (state.outcome?.kind !== "error" || isLangWatchQLResultStale(state))
    return NO_FAILURE_VIEW;
  const failure = readLangWatchQLFailure(state.outcome.error);
  return {
    markers: lwqlEditorMarkers(failure),
    missingParameters:
      failure.code === LWQL_PARAMETER_MISSING_CODE ? failure.parameters : [],
    reservedParameters:
      failure.code === LWQL_RESERVED_PARAMETER_SUPPLIED_CODE ? failure.parameters : [],
  };
}

function chartResultLabel(sql: string): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}…` : collapsed;
}

function parseSpecText(
  text: string | null | undefined,
): Record<string, unknown> | undefined {
  if (text === null || text === void 0) return void 0;

  try {
    const parsed: unknown = JSON.parse(text);
    const record = z.record(z.string(), z.unknown()).safeParse(parsed);
    return record.success ? record.data : void 0;
  } catch {
    return void 0;
  }
}

function useDraftInsert(
  query: LangWatchQLWorkbenchQuery,
  exampleSql: string | undefined,
) {
  const insertRef = useRef<((text: string) => void) | null>(null);
  const registerInsert = useCallback((insert: ((text: string) => void) | null) => {
    insertRef.current = insert;
  }, []);
  const insert = useCallback(
    (text: string) => {
      if (insertRef.current) return insertRef.current(text);
      query.setSql(
        query.state.draft.sql.length === 0
          ? text
          : `${query.state.draft.sql}${query.state.draft.sql.endsWith("\n") ? "" : "\n"}${text}`,
      );
    },
    [query],
  );
  return {
    registerInsert,
    insertExample: exampleSql === void 0 ? void 0 : () => insert(exampleSql),
    insert,
  };
}

function useTimeWindow(
  query: LangWatchQLWorkbenchQuery,
  pageTimeWindow: LangWatchQLTimeWindowValues,
  openedRevision: number,
) {
  const { setTimeWindow } = query;
  const [override, setOverride] = useState<{
    revision: number;
    value: LangWatchQLTimeWindowValues;
  } | null>(null);
  const [sendable, setSendable] = useState(true);
  const held = override?.revision === openedRevision ? override.value : void 0;
  const value = held ?? pageTimeWindow;
  useEffect(() => setTimeWindow(value), [setTimeWindow, value]);
  return {
    value,
    overridden: held !== void 0,
    sendable,
    onSendableChange: setSendable,
    onOverride: (next: LangWatchQLTimeWindowValues) =>
      setOverride({ revision: openedRevision, value: next }),
    onFollowPage: () => setOverride(null),
  };
}

export function LangWatchQLWorkbench({
  schema,
  query,
  pageTimeWindow,
  editorTheme = "vs",
  initialParameters,
  openedRevision = 0,
  openedSpecText,
  renderChart,
  renderToolbar,
  renderError,
}: LangWatchQLWorkbenchProps) {
  const [schemaVisible, setSchemaVisible] = useState(true);
  const [parametersSendable, setParametersSendable] = useState(true);
  const [specDraft, setSpecDraft] = useState<{
    revision: number;
    text: string | null | undefined;
  }>({ revision: openedRevision, text: void 0 });
  useEffect(() => setParametersSendable(true), [openedRevision]);
  const failure = useMemo(() => failureView(query.state), [query.state]);
  const { registerInsert, insertExample, insert } = useDraftInsert(
    query,
    schema.model.datasets[0]?.exampleSql,
  );
  const timeWindow = useTimeWindow(query, pageTimeWindow, openedRevision);
  const editedSpecText = specDraft.revision === openedRevision ? specDraft.text : void 0;
  const shownSpecText =
    editedSpecText === void 0 ? (openedSpecText ?? null) : editedSpecText;
  const onEditedSpecTextChange = useCallback(
    (text: string | null) => setSpecDraft({ revision: openedRevision, text }),
    [openedRevision],
  );
  const onParametersChange = useCallback(
    ({ parameters, sendable }: LangWatchQLParametersChange) => {
      query.setParameters(parameters);
      setParametersSendable(sendable);
    },
    [query],
  );
  const followsTimeWindow =
    query.state.outcome?.kind === "result" && !isLangWatchQLResultStale(query.state)
      ? query.state.outcome.result.followsTimeWindow
      : void 0;
  const vegaLiteSpec = parseSpecText(shownSpecText);
  const draft = {
    sql: query.state.draft.sql,
    parameters: query.state.draft.parameters,
    ...(vegaLiteSpec ? { vegaLiteSpec } : {}),
  };
  const result = query.state.outcome?.kind === "result" ? query.state.outcome : void 0;

  return (
    <HStack
      align="stretch"
      gap={0}
      width="full"
      flex="1"
      minHeight={0}
      data-testid="lwql-workbench"
    >
      {schemaVisible && (
        <Box
          width="292px"
          flexShrink={0}
          overflowY="auto"
          background="bg.panel"
          borderRightWidth="1px"
          borderColor="border"
        >
          <LangWatchQLSchemaBrowser
            model={schema.model}
            isLoading={schema.isLoading}
            error={schema.error}
            onInsert={insert}
            renderError={
              renderError
                ? (error) => renderError(error, "Couldn't load the schema")
                : void 0
            }
          />
        </Box>
      )}
      <Box
        flex="1"
        minWidth={0}
        minHeight={0}
        display="flex"
        flexDirection="column"
        gap={3}
        padding={4}
      >
        <Box
          flexShrink={0}
          background="bg.panel"
          borderWidth="1px"
          borderColor="border"
          borderRadius="10px"
          boxShadow="xs"
          overflow="hidden"
        >
          <HStack
            gap={2}
            paddingX={3}
            paddingY={2}
            borderBottomWidth="1px"
            borderColor="border"
          >
            <Button
              size="xs"
              variant="ghost"
              aria-label={schemaVisible ? "Hide the schema" : "Show the schema"}
              onClick={() => setSchemaVisible((value) => !value)}
            >
              <Box aria-hidden="true" display="flex">
                {schemaVisible ? (
                  <PanelLeftClose size={14} />
                ) : (
                  <PanelLeftOpen size={14} />
                )}
              </Box>
            </Button>
            <Text fontSize="13px" fontWeight="600">
              Query
            </Text>
            <Box flex="1" />
            {renderToolbar?.({ canSave: query.state.draft.sql.trim().length > 0, draft })}
            <Kbd size="sm" aria-hidden="true">
              ⌘⏎
            </Kbd>
            {query.state.isInFlight ? (
              <>
                <Button size="sm" variant="outline" onClick={query.cancelQuery}>
                  Cancel
                </Button>
                <Button size="sm" colorPalette="orange" disabled opacity={0.85}>
                  <Spinner size="xs" /> Running
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                colorPalette="orange"
                disabled={
                  query.state.draft.sql.trim().length === 0 ||
                  !parametersSendable ||
                  !timeWindow.sendable
                }
                onClick={query.runQuery}
              >
                {query.actionLabel}
              </Button>
            )}
          </HStack>
          <LangWatchQLEditor
            sql={query.state.draft.sql}
            onChange={query.setSql}
            schema={schema.model}
            markers={failure.markers}
            registerInsert={registerInsert}
            onRun={query.runQuery}
            theme={editorTheme}
          />
          <Box
            borderTopWidth="1px"
            borderColor="border"
            background="bg.subtle"
            paddingX={3}
            paddingY={2}
            display="flex"
            flexDirection="column"
            gap={3}
          >
            <LangWatchQLTimeWindowEditor
              value={timeWindow.value}
              overridden={timeWindow.overridden}
              onOverride={timeWindow.onOverride}
              onFollowPage={timeWindow.onFollowPage}
              followsTimeWindow={followsTimeWindow}
              onSendableChange={timeWindow.onSendableChange}
            />
            <LangWatchQLParametersEditor
              key={`parameters-${openedRevision}`}
              onChange={onParametersChange}
              missingParameters={failure.missingParameters}
              reservedParameters={failure.reservedParameters}
              {...(initialParameters ? { initialParameters } : {})}
            />
          </Box>
        </Box>
        <Box
          background="bg.panel"
          borderWidth="1px"
          borderColor="border"
          borderRadius="10px"
          boxShadow="xs"
          overflow="hidden"
          flex="1"
          minHeight={0}
          display="flex"
          flexDirection="column"
        >
          <LangWatchQLResultPane
            state={query.state}
            onRun={query.runQuery}
            {...(insertExample ? { onInsertExample: insertExample } : {})}
            renderError={renderError}
            renderChartArea={
              result
                ? (view, openSpecification) =>
                    renderChart({
                      view,
                      openSpecification,
                      result: result.result,
                      submittedLabel: chartResultLabel(result.snapshot.sql),
                      editedSpecText: shownSpecText,
                      onEditedSpecTextChange,
                    })
                : void 0
            }
          />
        </Box>
      </Box>
    </HStack>
  );
}
