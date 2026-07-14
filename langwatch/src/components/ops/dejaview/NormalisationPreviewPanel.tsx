import {
  Badge,
  Box,
  Button,
  Center,
  HStack,
  Input,
  NativeSelect,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FlaskConical, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type RouterOutputs } from "~/utils/api";
import dynamic from "~/utils/compat/next-dynamic";
import type { Monaco, OnMount } from "@monaco-editor/react";
import {
  BONSAI_LANGUAGE_ID,
  evaluateBonsaiExpression,
  isValidBonsaiExpression,
  registerBonsaiLanguage,
  setBonsaiCompletionKeys,
  validateBonsaiModel,
} from "./bonsaiMonaco";
import type { EventResult } from "./types";

/**
 * Deja View normalisation preview: replays this aggregate's stored raw
 * span events through the canonicalisation code of the RUNNING build and
 * shows the produced attributes, the rules that fired, the drift vs what
 * is stored, and — when experimental mapping rules are supplied — the
 * impact of those rules on every projection folding this aggregate.
 * Rules can be regex blocks or bonsai expressions (Monaco-edited, with
 * autocomplete over the selected event's attribute keys). Read-only.
 */

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={2} color="fg.muted" textStyle="xs">
      Loading editor...
    </Box>
  ),
});

const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received";

/** Canonical keys worth writing to — surfaced as target suggestions. */
const KNOWN_TARGET_KEYS = [
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "langwatch.input",
  "langwatch.output",
  "langwatch.span.type",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "gen_ai.conversation.id",
] as const;

const EXPRESSION_EXAMPLES: Array<{
  label: string;
  expression: string;
  targetKey: string;
}> = [
  {
    label: "Lift a vendor payload field",
    expression: 'attr("gcp.vertex.agent.llm_request").contents',
    targetKey: "gen_ai.input.messages",
  },
  {
    label: "User messages only",
    expression:
      'attr("gen_ai.input.messages") |> filter(.role == "user") |> map(.content)',
    targetKey: "langwatch.input",
  },
  {
    label: "Consume with fallback",
    expression: 'take("vendor.custom_output") ?? attr("langwatch.output")',
    targetKey: "langwatch.output",
  },
  {
    label: "Total tokens",
    expression:
      '(attr("gen_ai.usage.input_tokens") ?? 0) + (attr("gen_ai.usage.output_tokens") ?? 0)',
    targetKey: "langwatch.usage.total_tokens",
  },
];

/** Shown above the expression editors as a quick how-it-works reference. */
const GENERIC_EXAMPLE_SNIPPET = `attr("gen_ai.request.model")                                read any attribute (dotted keys need attr)
attr("vendor.messages") |> filter(.role == "user") |> map(.content)   pipe through transforms
take("vendor.raw_output") ?? attr("langwatch.output")       take() consumes the source, ?? falls back
has("gen_ai.output.messages")                               probe for a key
attrs                                                       the whole attribute map`;

type MapRuleDraft = {
  key: string;
  matcher: "exact" | "regex";
  valuePattern: string;
  actionType: "copy" | "move";
  targetKey: string;
};

type ExpressionRuleDraft = {
  expression: string;
  targetKey: string;
};

type PreviewInput = Parameters<
  ReturnType<typeof api.ops.previewNormalisation.useMutation>["mutate"]
>[0];

const AUTO_RUN_DEBOUNCE_MS = 700;

/**
 * Shared Monaco options. quickSuggestions.strings is the important one:
 * the main completion surface is INSIDE attr("…") string quotes, and
 * Monaco disables quick suggestions in strings by default — without
 * this, attribute-key completions never appear. Word-based suggestions
 * are disabled so buffer words don't drown the curated list.
 */
const BONSAI_EDITOR_OPTIONS = {
  minimap: { enabled: false },
  lineNumbers: "off" as const,
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 4,
  renderLineHighlight: "none" as const,
  overviewRulerLanes: 0,
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  fontSize: 12,
  automaticLayout: true,
  quickSuggestions: { other: true, comments: false, strings: true },
  suggestOnTriggerCharacters: true,
  wordBasedSuggestions: "off" as const,
};

export function NormalisationPreviewPanel({
  aggregateId,
  tenantId,
  events,
}: {
  aggregateId: string;
  tenantId: string;
  events: EventResult[];
}) {
  const [mapRules, setMapRules] = useState<MapRuleDraft[]>([]);
  const [expressionRules, setExpressionRules] = useState<
    ExpressionRuleDraft[]
  >([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("all");
  const preview = api.ops.previewNormalisation.useMutation();

  const spanEvents = useMemo(
    () => events.filter((e) => e.eventType === SPAN_RECEIVED_EVENT_TYPE),
    [events],
  );

  // Attribute keys of the selected event (or all span events) feed both
  // the source-key datalist and the Monaco attr() completions.
  const attributeKeys = useMemo(() => {
    const relevant =
      selectedEventId === "all"
        ? spanEvents
        : spanEvents.filter((e) => e.eventId === selectedEventId);
    const keys = new Set<string>();
    for (const event of relevant) {
      for (const key of extractAttributeKeys(event.payload)) keys.add(key);
    }
    return [...keys].sort();
  }, [spanEvents, selectedEventId]);

  useEffect(() => {
    setBonsaiCompletionKeys(attributeKeys);
  }, [attributeKeys]);

  const buildInput = (): PreviewInput => ({
    aggregateId,
    tenantId,
    eventId: selectedEventId === "all" ? undefined : selectedEventId,
    rules: [
      ...mapRules
        .filter((r) => r.key.length > 0 && r.targetKey.length > 0)
        .map((r) => ({
          kind: "map" as const,
          match: {
            key: r.key,
            keyIsRegex: r.matcher === "regex",
            valuePattern:
              r.valuePattern.length > 0 ? r.valuePattern : undefined,
          },
          action: { type: r.actionType, targetKey: r.targetKey },
        })),
      ...expressionRules
        .filter(
          (r) =>
            r.targetKey.length > 0 && isValidBonsaiExpression(r.expression),
        )
        .map((r) => ({
          kind: "expression" as const,
          expression: r.expression,
          targetKey: r.targetKey,
        })),
    ],
  });

  // Payload rule indexes ≠ draft indexes (empty/invalid drafts are
  // filtered out), so remember which payload rule maps to which
  // expression-draft editor for error highlighting.
  const expressionPayloadIndexRef = useRef<Map<number, number>>(new Map());
  const buildInputTracked = (): PreviewInput => {
    const input = buildInput();
    const mapping = new Map<number, number>();
    let draftIndex = -1;
    (input.rules ?? []).forEach((rule, payloadIndex) => {
      if (rule.kind !== "expression") return;
      // Recover the draft index by matching filtered order.
      draftIndex = expressionRules.findIndex(
        (d, i) => i > draftIndex && d.expression === rule.expression,
      );
      if (draftIndex >= 0) mapping.set(payloadIndex, draftIndex);
    });
    expressionPayloadIndexRef.current = mapping;
    return input;
  };

  const run = () => preview.mutate(buildInputTracked());

  // Live updates: once the operator has run the preview, edits re-run it
  // automatically (debounced). Invalid expressions are filtered out by
  // buildInput, so typing never spams the server with parse errors.
  const hasRunRef = useRef(false);
  if (preview.data && !hasRunRef.current) hasRunRef.current = true;
  const serializedInput = JSON.stringify({
    mapRules,
    expressionRules,
    selectedEventId,
  });
  useEffect(() => {
    if (!hasRunRef.current) return;
    const timer = setTimeout(
      () => preview.mutate(buildInputTracked()),
      AUTO_RUN_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializedInput]);

  const result = preview.data;
  // Every array is guarded: if the API process is serving an older build
  // of the preview endpoint (dev-server version skew), missing fields
  // must degrade to empty sections, never crash the panel.
  const resultSpans = result?.spans ?? [];
  const resultProjections = result?.projections ?? [];
  const resultRuleStats = result?.ruleStats ?? [];

  // Aggregate per-rule runtime errors across spans and attach them to
  // the expression editor that produced them.
  const expressionErrorsByDraft = useMemo(() => {
    const byDraft = new Map<number, { count: number; message: string }>();
    for (const span of resultSpans) {
      for (const err of span.ruleErrors ?? []) {
        const draftIndex = expressionPayloadIndexRef.current.get(err.ruleIndex);
        if (draftIndex === undefined) continue;
        const existing = byDraft.get(draftIndex);
        if (existing) {
          existing.count += 1;
        } else {
          byDraft.set(draftIndex, { count: 1, message: err.error });
        }
      }
    }
    return byDraft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Playground context: prefer the replayed canonical attributes of the
  // selected event once a run exists; before that, decode the raw OTLP
  // attributes straight off the stored event so the playground works
  // without a server round-trip.
  const playgroundContext = useMemo(() => {
    const targetEventId =
      selectedEventId !== "all" ? selectedEventId : spanEvents[0]?.eventId;
    if (targetEventId === undefined) return null;
    const fromRun = resultSpans.find((s) => s.eventId === targetEventId);
    if (fromRun) {
      return {
        attributes: fromRun.replayedAttributes as Record<string, unknown>,
        label: "replayed canonical attributes",
      };
    }
    const event = spanEvents.find((e) => e.eventId === targetEventId);
    if (!event) return null;
    return {
      attributes: decodeOtlpSpanAttributes(event.payload),
      label: "raw event attributes — run the preview for the canonical view",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, selectedEventId, spanEvents]);

  return (
    <Box flex={1} overflowY="auto" minH={0} w="full" padding={6}>
      <VStack align="stretch" gap={4} maxW="1200px">
        <HStack gap={2} wrap="wrap">
          <FlaskConical size={16} />
          <Text textStyle="sm" fontWeight="semibold">
            Normalisation preview
          </Text>
          <Text textStyle="xs" color="fg.muted">
            Replays stored span events through this build&apos;s
            canonicalisation. Read-only.
          </Text>
          <Box flex={1} />
          <Text textStyle="xs" color="fg.muted">
            Event:
          </Text>
          <NativeSelect.Root size="xs" width="320px">
            <NativeSelect.Field
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
            >
              <option value="all">All span events ({spanEvents.length})</option>
              {spanEvents.map((event, index) => (
                <option key={event.eventId} value={event.eventId}>
                  #{index + 1} · {spanNameFromPayload(event.payload)}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>

        <datalist id="nprev-source-keys">
          {attributeKeys.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
        <datalist id="nprev-target-keys">
          {KNOWN_TARGET_KEYS.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>

        <VStack
          align="stretch"
          gap={2}
          padding={3}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
        >
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Map rules — match a source key, write a canonical key
          </Text>
          {mapRules.map((rule, index) => (
            <HStack key={index} gap={2} align="center">
              <Input
                size="xs"
                fontFamily="mono"
                placeholder="source key"
                list="nprev-source-keys"
                value={rule.key}
                onChange={(e) =>
                  updateAt(setMapRules, index, { key: e.target.value })
                }
                flex={2}
              />
              <NativeSelect.Root size="xs" width="90px" flexShrink={0}>
                <NativeSelect.Field
                  value={rule.matcher}
                  onChange={(e) =>
                    updateAt(setMapRules, index, {
                      matcher: e.target.value as MapRuleDraft["matcher"],
                    })
                  }
                >
                  <option value="exact">exact</option>
                  <option value="regex">regex</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Input
                size="xs"
                fontFamily="mono"
                placeholder="value regex (group 1 extracted, optional)"
                value={rule.valuePattern}
                onChange={(e) =>
                  updateAt(setMapRules, index, { valuePattern: e.target.value })
                }
                flex={2}
              />
              <NativeSelect.Root size="xs" width="90px" flexShrink={0}>
                <NativeSelect.Field
                  value={rule.actionType}
                  onChange={(e) =>
                    updateAt(setMapRules, index, {
                      actionType: e.target.value as MapRuleDraft["actionType"],
                    })
                  }
                >
                  <option value="copy">copy →</option>
                  <option value="move">move →</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Input
                size="xs"
                fontFamily="mono"
                placeholder="target key"
                list="nprev-target-keys"
                value={rule.targetKey}
                onChange={(e) =>
                  updateAt(setMapRules, index, { targetKey: e.target.value })
                }
                flex={2}
              />
              <Button
                size="xs"
                variant="ghost"
                onClick={() => removeAt(setMapRules, index)}
                title="Remove rule"
              >
                <Trash2 size={13} />
              </Button>
            </HStack>
          ))}
          <HStack>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setMapRules((prev) => [
                  ...prev,
                  {
                    key: "",
                    matcher: "exact",
                    valuePattern: "",
                    actionType: "copy",
                    targetKey: "",
                  },
                ])
              }
            >
              <Plus size={13} />
              Add map rule
            </Button>
          </HStack>
        </VStack>

        <VStack
          align="stretch"
          gap={2}
          padding={3}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
        >
          <HStack gap={2} wrap="wrap">
            <Text textStyle="xs" fontWeight="medium" color="fg.muted">
              Expression rules — bonsai expressions over the span&apos;s
              attributes; the result is written to the target key
            </Text>
            <Box flex={1} />
            {EXPRESSION_EXAMPLES.map((example) => (
              <Button
                key={example.label}
                size="xs"
                variant="ghost"
                color="fg.muted"
                onClick={() =>
                  setExpressionRules((prev) => [
                    ...prev,
                    {
                      expression: example.expression,
                      targetKey: example.targetKey,
                    },
                  ])
                }
                title={example.expression}
              >
                + {example.label}
              </Button>
            ))}
          </HStack>
          <Box
            as="pre"
            padding={2}
            borderRadius="sm"
            bg="bg.muted"
            overflowX="auto"
            textStyle="xs"
            fontFamily="mono"
            color="fg.muted"
          >
            {GENERIC_EXAMPLE_SNIPPET}
          </Box>
          {expressionRules.map((rule, index) => (
            <ExpressionRuleEditor
              key={index}
              rule={rule}
              serverError={expressionErrorsByDraft.get(index) ?? null}
              onChange={(patch) => updateAt(setExpressionRules, index, patch)}
              onRemove={() => removeAt(setExpressionRules, index)}
            />
          ))}
          <HStack>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                setExpressionRules((prev) => [
                  ...prev,
                  { expression: "", targetKey: "" },
                ])
              }
            >
              <Plus size={13} />
              Add expression rule
            </Button>
            <Box flex={1} />
            <Button
              size="xs"
              colorPalette="blue"
              onClick={run}
              loading={preview.isPending}
            >
              <Play size={13} />
              Run preview
            </Button>
          </HStack>
          <Text textStyle="xs" color="fg.muted">
            Map rules run before expression rules. After the first run,
            edits re-run the preview automatically.
          </Text>
        </VStack>

        {playgroundContext && (
          <PlaygroundSection
            attributes={playgroundContext.attributes}
            contextLabel={playgroundContext.label}
          />
        )}

        {preview.error && (
          <Box
            padding={3}
            borderRadius="md"
            borderWidth="1px"
            borderColor="red.200"
          >
            <Text textStyle="xs" color="red.500">
              {preview.error.message}
            </Text>
          </Box>
        )}

        {preview.isPending && !result && (
          <Center paddingY={8}>
            <Spinner size="md" />
          </Center>
        )}

        {result && (
          <VStack align="stretch" gap={3} opacity={preview.isPending ? 0.6 : 1}>
            <HStack gap={2} wrap="wrap">
              <Badge size="sm" variant="outline">
                {result.eventsScanned} events scanned
              </Badge>
              <Badge size="sm" variant="outline">
                {result.spanEventsFound} span events
              </Badge>
              {(result.skippedInvalidEvents ?? 0) > 0 && (
                <Badge size="sm" variant="outline" colorPalette="orange">
                  {result.skippedInvalidEvents} unparseable
                </Badge>
              )}
              {resultRuleStats.map((stat) => (
                <Badge
                  key={stat.ruleIndex}
                  size="sm"
                  variant="subtle"
                  colorPalette={stat.matchedSpanCount > 0 ? "green" : "gray"}
                >
                  rule {stat.ruleIndex + 1}: {stat.matchedSpanCount} span
                  {stat.matchedSpanCount === 1 ? "" : "s"}
                </Badge>
              ))}
            </HStack>

            {resultProjections.length > 0 && (
              <VStack align="stretch" gap={2}>
                <Text textStyle="sm" fontWeight="semibold">
                  Projection impact
                </Text>
                <Text textStyle="xs" color="fg.muted">
                  Every projection folding this aggregate, with vs without
                  your rules. Rules apply across all span events here —
                  projections accumulate over the whole event stream.
                </Text>
                {resultProjections.map((impact) => (
                  <VStack
                    key={impact.projectionName}
                    align="stretch"
                    gap={1}
                    padding={3}
                    borderWidth="1px"
                    borderColor="border.muted"
                    borderRadius="md"
                  >
                    <HStack gap={2}>
                      <Text textStyle="sm" fontWeight="medium">
                        {impact.projectionName}
                      </Text>
                      <Badge size="sm" variant="subtle">
                        {impact.aggregateType}
                      </Badge>
                      <Text textStyle="xs" color="fg.muted">
                        {impact.appliedEventCount} events folded
                      </Text>
                      <Box flex={1} />
                      {impact.changes.length === 0 ? (
                        <Badge size="sm" variant="subtle" colorPalette="gray">
                          no change
                        </Badge>
                      ) : (
                        <Badge size="sm" variant="subtle" colorPalette="orange">
                          {impact.changes.length} change
                          {impact.changes.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </HStack>
                    {impact.changes.length > 0 && (
                      <DiffTable entries={impact.changes} />
                    )}
                  </VStack>
                ))}
              </VStack>
            )}

            {resultSpans.length === 0 && (
              <Text textStyle="sm" color="fg.muted">
                No span-received events to replay
                {selectedEventId !== "all" ? " for the selected event" : ""}.
              </Text>
            )}

            {resultSpans.map((span) => (
              <SpanPreviewCard key={span.eventId} span={span} />
            ))}
          </VStack>
        )}
      </VStack>
    </Box>
  );
}

function ExpressionRuleEditor({
  rule,
  serverError,
  onChange,
  onRemove,
}: {
  rule: ExpressionRuleDraft;
  serverError: { count: number; message: string } | null;
  onChange: (patch: Partial<ExpressionRuleDraft>) => void;
  onRemove: () => void;
}) {
  const monacoRef = useRef<Monaco | null>(null);

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    registerBonsaiLanguage(monaco);
    const model = editor.getModel();
    if (model) validateBonsaiModel(monaco, model);
    editor.onDidChangeModelContent(() => {
      const currentModel = editor.getModel();
      if (currentModel) validateBonsaiModel(monaco, currentModel);
    });
  };

  return (
    <VStack align="stretch" gap={1}>
    <HStack gap={2} align="start">
      <Box
        flex={4}
        borderWidth="1px"
        borderColor={serverError ? "red.400" : "border.muted"}
        borderRadius="sm"
        overflow="hidden"
      >
        <MonacoEditor
          height="58px"
          language={BONSAI_LANGUAGE_ID}
          value={rule.expression}
          beforeMount={(monaco: Monaco) => registerBonsaiLanguage(monaco)}
          onMount={onMount}
          onChange={(value: string | undefined) =>
            onChange({ expression: value ?? "" })
          }
          options={{
            ...BONSAI_EDITOR_OPTIONS,
            scrollbar: { vertical: "hidden" },
            placeholder: 'attr("vendor.key") |> upper',
          }}
        />
      </Box>
      <Text textStyle="xs" color="fg.muted" paddingTop={2}>
        →
      </Text>
      <Input
        size="xs"
        fontFamily="mono"
        placeholder="target key"
        list="nprev-target-keys"
        value={rule.targetKey}
        onChange={(e) => onChange({ targetKey: e.target.value })}
        flex={2}
      />
      <Button size="xs" variant="ghost" onClick={onRemove} title="Remove rule">
        <Trash2 size={13} />
      </Button>
    </HStack>
    {serverError && (
      <Text textStyle="xs" color="red.500">
        failed on {serverError.count} span
        {serverError.count === 1 ? "" : "s"}: {serverError.message}
      </Text>
    )}
    </VStack>
  );
}

type PreviewResult = RouterOutputs["ops"]["previewNormalisation"];
type SpanPreview = PreviewResult["spans"][number];
type DiffEntry = NonNullable<SpanPreview["storedDiff"]>[number];

function SpanPreviewCard({ span }: { span: SpanPreview }) {
  const [showAttributes, setShowAttributes] = useState(false);

  return (
    <VStack
      align="stretch"
      gap={2}
      padding={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
    >
      <HStack gap={2}>
        <Text textStyle="sm" fontWeight="medium">
          {span.name}
        </Text>
        <Text textStyle="xs" fontFamily="mono" color="fg.muted">
          {span.spanId}
        </Text>
        <Box flex={1} />
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setShowAttributes((s) => !s)}
        >
          {showAttributes ? "Hide" : "Show"} replayed attributes
        </Button>
      </HStack>

      {span.appliedRules.length > 0 && (
        <HStack gap={1} wrap="wrap">
          {span.appliedRules.map((rule, i) => (
            <Badge key={i} size="sm" variant="subtle" fontFamily="mono">
              {rule}
            </Badge>
          ))}
        </HStack>
      )}

      {span.ruleErrors.length > 0 && (
        <VStack align="stretch" gap={1}>
          {span.ruleErrors.map((err) => (
            <Text key={err.ruleIndex} textStyle="xs" color="red.500">
              rule {err.ruleIndex + 1} failed on this span: {err.error}
            </Text>
          ))}
        </VStack>
      )}

      {span.storedDiff !== null && (
        <DiffSection
          title={
            span.storedDiff.length === 0
              ? "Stored vs replayed: identical (this build reproduces storage)"
              : `Stored vs replayed: ${span.storedDiff.length} attribute(s) differ`
          }
          entries={span.storedDiff}
        />
      )}

      {span.rulesDiff !== null && (
        <DiffSection
          title={
            span.rulesDiff.length === 0
              ? "Mapping rules: no effect on this span"
              : `Mapping rules: ${span.rulesDiff.length} attribute(s) affected`
          }
          entries={span.rulesDiff}
        />
      )}

      {showAttributes && (
        <Box
          as="pre"
          padding={2}
          borderRadius="sm"
          bg="bg.muted"
          overflowX="auto"
          textStyle="xs"
          fontFamily="mono"
        >
          {JSON.stringify(span.replayedAttributes, null, 2)}
        </Box>
      )}
    </VStack>
  );
}

const DIFF_COLOR: Record<string, string> = {
  added: "green",
  removed: "red",
  changed: "orange",
};

function DiffSection({
  title,
  entries,
}: {
  title: string;
  entries: DiffEntry[];
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text textStyle="xs" color="fg.muted">
        {title}
      </Text>
      {entries.length > 0 && <DiffTable entries={entries} />}
    </VStack>
  );
}

function DiffTable({ entries }: { entries: DiffEntry[] }) {
  return (
    <Box overflowX="auto">
      <Table.Root size="sm" variant="line">
        <Table.Body>
          {entries.map((entry) => (
            <Table.Row key={`${entry.kind}:${entry.key}`}>
              <Table.Cell width="90px">
                <Badge
                  size="sm"
                  variant="subtle"
                  colorPalette={DIFF_COLOR[entry.kind] ?? "gray"}
                >
                  {entry.kind}
                </Badge>
              </Table.Cell>
              <Table.Cell fontFamily="mono" textStyle="xs">
                {entry.key}
                {entry.ruleIndex !== undefined && (
                  <Text as="span" color="fg.muted">
                    {" "}
                    ← {entry.sourceKey ?? `rule ${entry.ruleIndex + 1} (expression)`}
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell
                fontFamily="mono"
                textStyle="xs"
                color="fg.muted"
                maxW="300px"
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                title={entry.before ?? undefined}
              >
                {entry.before ?? "—"}
              </Table.Cell>
              <Table.Cell
                fontFamily="mono"
                textStyle="xs"
                maxW="300px"
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                title={entry.after ?? undefined}
              >
                {entry.after ?? "—"}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

const PLAYGROUND_DEBOUNCE_MS = 350;
const MAX_PLAYGROUND_RESULT_LENGTH = 8_000;

/**
 * Free-form bonsai scratchpad: write any expression and see it evaluated
 * live (client-side, no server round-trip) against the selected event's
 * attributes. The fastest way to iterate before committing something to
 * an expression rule.
 */
function PlaygroundSection({
  attributes,
  contextLabel,
}: {
  attributes: Record<string, unknown>;
  contextLabel: string;
}) {
  const [code, setCode] = useState("");
  const [output, setOutput] = useState<
    { ok: true; value: string } | { ok: false; error: string } | null
  >(null);

  const attributesRef = useRef(attributes);
  attributesRef.current = attributes;

  useEffect(() => {
    if (code.trim().length === 0) {
      setOutput(null);
      return;
    }
    const timer = setTimeout(() => {
      const evaluated = evaluateBonsaiExpression(code, attributesRef.current);
      if (evaluated.ok) {
        let rendered: string;
        try {
          rendered = JSON.stringify(evaluated.value, null, 2) ?? "undefined";
        } catch {
          rendered = String(evaluated.value);
        }
        if (rendered.length > MAX_PLAYGROUND_RESULT_LENGTH) {
          rendered = `${rendered.slice(0, MAX_PLAYGROUND_RESULT_LENGTH)}…`;
        }
        setOutput({ ok: true, value: rendered });
      } else {
        setOutput(evaluated);
      }
    }, PLAYGROUND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, attributes]);

  const onMount: OnMount = (editor, monaco) => {
    registerBonsaiLanguage(monaco);
    const validate = () => {
      const model = editor.getModel();
      if (model) validateBonsaiModel(monaco, model);
    };
    validate();
    editor.onDidChangeModelContent(validate);
  };

  return (
    <VStack
      align="stretch"
      gap={2}
      padding={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
    >
      <HStack gap={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          Playground — evaluate any expression live
        </Text>
        <Box flex={1} />
        <Text textStyle="xs" color="fg.muted">
          context: {contextLabel}
        </Text>
      </HStack>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="sm"
        overflow="hidden"
      >
        <MonacoEditor
          height="180px"
          language={BONSAI_LANGUAGE_ID}
          value={code}
          beforeMount={(monaco: Monaco) => registerBonsaiLanguage(monaco)}
          onMount={onMount}
          onChange={(value: string | undefined) => setCode(value ?? "")}
          options={{
            ...BONSAI_EDITOR_OPTIONS,
            lineNumbers: "on",
            placeholder:
              'attr("gcp.vertex.agent.llm_request").contents |> map(.parts)',
          }}
        />
      </Box>
      {output !== null &&
        (output.ok ? (
          <Box
            as="pre"
            padding={2}
            borderRadius="sm"
            bg="bg.muted"
            overflowX="auto"
            textStyle="xs"
            fontFamily="mono"
            maxH="260px"
            overflowY="auto"
          >
            {output.value}
          </Box>
        ) : (
          <Text textStyle="xs" color="red.500" fontFamily="mono">
            {output.error}
          </Text>
        ))}
    </VStack>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function updateAt<T>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  index: number,
  patch: Partial<T>,
): void {
  setter((prev) =>
    prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
  );
}

function removeAt<T>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  index: number,
): void {
  setter((prev) => prev.filter((_, i) => i !== index));
}

/** Pulls the OTLP attribute keys out of a span-received event payload. */
function extractAttributeKeys(payload: unknown): string[] {
  const parsed = typeof payload === "string" ? safeParse(payload) : payload;
  if (!parsed || typeof parsed !== "object") return [];
  const span = (parsed as { span?: unknown }).span;
  if (!span || typeof span !== "object") return [];
  const attributes = (span as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((kv) =>
      kv && typeof kv === "object" ? (kv as { key?: unknown }).key : undefined,
    )
    .filter((key): key is string => typeof key === "string");
}

function spanNameFromPayload(payload: unknown): string {
  const parsed = typeof payload === "string" ? safeParse(payload) : payload;
  const name =
    parsed && typeof parsed === "object"
      ? ((parsed as { span?: { name?: unknown } }).span?.name ?? null)
      : null;
  return typeof name === "string" && name.length > 0 ? name : "span";
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Decodes a stored span-received event's OTLP attributes into plain
 * values for the playground: {stringValue} strings (JSON-looking ones
 * parsed, mirroring the pipeline's parseJsonStringValues), int/double/
 * bool values, and nested array/kvlist values.
 */
function decodeOtlpSpanAttributes(payload: unknown): Record<string, unknown> {
  const parsed = typeof payload === "string" ? safeParse(payload) : payload;
  const span =
    parsed && typeof parsed === "object"
      ? (parsed as { span?: unknown }).span
      : null;
  const attributes =
    span && typeof span === "object"
      ? (span as { attributes?: unknown }).attributes
      : null;
  if (!Array.isArray(attributes)) return {};

  const out: Record<string, unknown> = {};
  for (const kv of attributes) {
    if (!kv || typeof kv !== "object") continue;
    const key = (kv as { key?: unknown }).key;
    if (typeof key !== "string") continue;
    out[key] = decodeOtlpAnyValue((kv as { value?: unknown }).value);
  }
  return out;
}

function decodeOtlpAnyValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (typeof v.stringValue === "string") {
    const s = v.stringValue.trim();
    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      const parsed = safeParse(v.stringValue);
      if (parsed !== null) return parsed;
    }
    return v.stringValue;
  }
  if (v.intValue !== undefined && v.intValue !== null) return Number(v.intValue);
  if (v.doubleValue !== undefined && v.doubleValue !== null) {
    return Number(v.doubleValue);
  }
  if (v.boolValue !== undefined && v.boolValue !== null) {
    return v.boolValue === true || v.boolValue === "true";
  }
  const arrayValue = v.arrayValue as { values?: unknown[] } | undefined;
  if (Array.isArray(arrayValue?.values)) {
    return arrayValue.values.map(decodeOtlpAnyValue);
  }
  const kvlistValue = v.kvlistValue as
    | { values?: Array<{ key?: unknown; value?: unknown }> }
    | undefined;
  if (Array.isArray(kvlistValue?.values)) {
    return Object.fromEntries(
      kvlistValue.values
        .filter((kv) => typeof kv?.key === "string")
        .map((kv) => [kv.key as string, decodeOtlpAnyValue(kv.value)]),
    );
  }
  return undefined;
}
