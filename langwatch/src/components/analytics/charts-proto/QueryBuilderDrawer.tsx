/**
 * charts-proto — the S1 guided query-builder drawer (PROTOTYPE).
 *
 * "+ Add widget → Trace query": a right-side panel of allowlist controls with a
 * LIVE preview that morphs as you turn each knob. Every control maps 1:1 to the
 * real β TRQL allowlist (see model.ts) — zero SQL, closed enums. The preview
 * runs on stubbed data and updates instantly (no debounce), which is what sells
 * the "live chart morphing" feel.
 */
import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "react-feather";
import { Drawer } from "~/components/ui/drawer";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Tooltip } from "~/components/ui/tooltip";
import {
  AGGREGATIONS,
  DIMENSIONS,
  MAX_AGGREGATIONS,
  MAX_GROUP_BY,
  METRICS,
  VISUALIZATIONS,
  type AggregationOp,
  type AggregationSpec,
  type DimensionColumn,
  type MetricColumn,
  type Visualization,
  type WidgetSpec,
  aggMeta,
  dimensionMeta,
  suggestTitle,
} from "./model";
import { runStubQuery, type StubWindow } from "./stubData";
import { WidgetRenderer } from "./WidgetRenderer";

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
    {children}
  </Text>
);

interface Props {
  open: boolean;
  editing?: WidgetSpec;
  window: StubWindow;
  windowLabel: string;
  onClose: () => void;
  onSave: (spec: Omit<WidgetSpec, "id">) => void;
}

const DEFAULT_DRAFT: Omit<WidgetSpec, "id"> = {
  title: "Traces",
  visualization: "bar",
  aggregations: [{ op: "count" }],
  groupBy: ["model"],
  filter: "",
  timeRangeMode: "inherit",
  colSpan: 6,
  rowSpan: 2,
};

export function QueryBuilderDrawer({
  open,
  editing,
  window: win,
  windowLabel,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<Omit<WidgetSpec, "id">>(DEFAULT_DRAFT);
  const [titleDirty, setTitleDirty] = useState(false);

  // Re-seed the draft each time the drawer opens (new widget vs edit).
  useEffect(() => {
    if (!open) return;
    setDraft(editing ? { ...editing } : { ...DEFAULT_DRAFT });
    setTitleDirty(!!editing);
  }, [open, editing]);

  // Auto-suggest the title from the query until the user overrides it.
  useEffect(() => {
    if (titleDirty) return;
    setDraft((d) => ({ ...d, title: suggestTitle(d) }));
  }, [draft.aggregations, draft.groupBy, titleDirty]);

  const previewSpec: WidgetSpec = useMemo(
    () => ({ ...draft, id: "__preview__" }),
    [draft],
  );
  const result = useMemo(() => runStubQuery(previewSpec, win), [previewSpec, win]);

  const patch = (p: Partial<Omit<WidgetSpec, "id">>) =>
    setDraft((d) => ({ ...d, ...p }));

  const setAggregation = (i: number, next: AggregationSpec) =>
    patch({ aggregations: draft.aggregations.map((a, j) => (j === i ? next : a)) });

  const addAggregation = () =>
    patch({
      aggregations: [
        ...draft.aggregations,
        { op: "avg", column: "durationMs" },
      ],
    });

  const removeAggregation = (i: number) =>
    patch({ aggregations: draft.aggregations.filter((_, j) => j !== i) });

  const remainingDims = DIMENSIONS.filter(
    (d) => !draft.groupBy.includes(d.column),
  );

  const chartUsesSingleMetric = draft.visualization !== "table";

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      placement="end"
      size="xl"
    >
      <Drawer.Content width="min(940px, 94vw)" maxWidth="94vw">
        <Drawer.Header borderBottomWidth="1px" borderColor="border">
          <HStack justify="space-between" width="100%">
            <Drawer.Title>{editing ? "Edit widget" : "Add widget"}</Drawer.Title>
            <Text fontSize="sm" color="fg.subtle">
              Trace query
            </Text>
          </HStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>

        <Drawer.Body padding={0}>
          <HStack align="stretch" gap={0} height="100%">
            {/* ── Controls ─────────────────────────────────────────── */}
            <VStack
              align="stretch"
              gap={5}
              padding={5}
              width="380px"
              flexShrink={0}
              borderRightWidth="1px"
              borderColor="border"
              overflowY="auto"
            >
              <VStack align="stretch" gap={2}>
                <FieldLabel>Visualization</FieldLabel>
                <SegmentedControl
                  size="sm"
                  value={draft.visualization}
                  items={VISUALIZATIONS.map((v) => ({
                    value: v.kind,
                    label: v.label,
                  }))}
                  onValueChange={(e) =>
                    patch({ visualization: e.value as Visualization })
                  }
                />
              </VStack>

              <VStack align="stretch" gap={2}>
                <FieldLabel>
                  {chartUsesSingleMetric ? "Metric" : "Columns"}
                </FieldLabel>
                {draft.aggregations.map((agg, i) => (
                  <AggregationRow
                    key={i}
                    agg={agg}
                    canRemove={draft.aggregations.length > 1}
                    dimmed={chartUsesSingleMetric && i > 0}
                    onChange={(next) => setAggregation(i, next)}
                    onRemove={() => removeAggregation(i)}
                  />
                ))}
                {!chartUsesSingleMetric &&
                draft.aggregations.length < MAX_AGGREGATIONS ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    alignSelf="start"
                    onClick={addAggregation}
                  >
                    <Plus size={13} /> Add column
                  </Button>
                ) : null}
                {chartUsesSingleMetric && draft.aggregations.length > 1 ? (
                  <Text fontSize="xs" color="fg.subtle">
                    This visualization charts the first metric.
                  </Text>
                ) : null}
              </VStack>

              <VStack align="stretch" gap={2}>
                <FieldLabel>Group by</FieldLabel>
                <HStack wrap="wrap" gap={2}>
                  {draft.groupBy.map((dim) => (
                    <HStack
                      key={dim}
                      gap={1}
                      paddingX={2}
                      paddingY={1}
                      borderWidth="1px"
                      borderColor="border"
                      borderRadius="md"
                      background="bg.muted"
                      fontSize="sm"
                    >
                      <Text>{dimensionMeta(dim).label}</Text>
                      <Box
                        as="button"
                        display="flex"
                        color="fg.subtle"
                        _hover={{ color: "fg" }}
                        onClick={() =>
                          patch({
                            groupBy: draft.groupBy.filter((d) => d !== dim),
                          })
                        }
                      >
                        <X size={13} />
                      </Box>
                    </HStack>
                  ))}
                  {draft.groupBy.length < MAX_GROUP_BY &&
                  remainingDims.length > 0 ? (
                    <NativeSelect.Root size="sm" width="auto">
                      <NativeSelect.Field
                        placeholder="+ Add"
                        value=""
                        onChange={(e) => {
                          const v = e.currentTarget.value as DimensionColumn;
                          if (v) patch({ groupBy: [...draft.groupBy, v] });
                        }}
                      >
                        {remainingDims.map((d) => (
                          <option key={d.column} value={d.column}>
                            {d.label}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  ) : null}
                </HStack>
                {draft.groupBy.length === 0 ? (
                  <Text fontSize="xs" color="fg.subtle">
                    No grouping — a single aggregate across all traces.
                  </Text>
                ) : null}
              </VStack>

              <VStack align="stretch" gap={2}>
                <FieldLabel>Filter</FieldLabel>
                <Input
                  size="sm"
                  fontFamily="mono"
                  placeholder="e.g. cost:>0.1"
                  value={draft.filter}
                  onChange={(e) => patch({ filter: e.currentTarget.value })}
                />
                <Text fontSize="xs" color="fg.subtle">
                  Liqe filter — same syntax as the trace search bar.
                </Text>
              </VStack>

              <VStack align="stretch" gap={2}>
                <FieldLabel>Time range</FieldLabel>
                <Tooltip content="In this prototype every widget inherits the dashboard range">
                  <Box
                    paddingX={3}
                    paddingY={2}
                    borderWidth="1px"
                    borderColor="border"
                    borderRadius="md"
                    fontSize="sm"
                    color="fg.muted"
                  >
                    Inherits dashboard range · {windowLabel}
                  </Box>
                </Tooltip>
              </VStack>

              <VStack align="stretch" gap={2}>
                <FieldLabel>Widget title</FieldLabel>
                <Input
                  size="sm"
                  value={draft.title}
                  onChange={(e) => {
                    setTitleDirty(true);
                    patch({ title: e.currentTarget.value });
                  }}
                />
              </VStack>
            </VStack>

            {/* ── Live preview ─────────────────────────────────────── */}
            <VStack align="stretch" gap={0} flex={1} minWidth="420px" padding={5}>
              <FieldLabel>Live preview</FieldLabel>
              <Box
                marginTop={3}
                borderWidth="1px"
                borderColor="border"
                borderRadius="lg"
                background="bg.panel"
                padding={4}
                flex={1}
                display="flex"
                flexDirection="column"
              >
                <Text fontWeight="600" marginBottom={3}>
                  {draft.title || "Untitled widget"}
                </Text>
                <Box flex={1} minHeight="300px">
                  <WidgetRenderer spec={previewSpec} result={result} height={320} />
                </Box>
              </Box>
              <Text fontSize="xs" color="fg.subtle" marginTop={3}>
                Preview uses sampled data. Wiring to the real tenant-isolated
                trace-query engine is post-pick.
              </Text>
            </VStack>
          </HStack>
        </Drawer.Body>

        <Drawer.Footer borderTopWidth="1px" borderColor="border" gap={3}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="orange"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {editing ? "Save changes" : "Add to dashboard"}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ── One metric/aggregation row ──────────────────────────────────────────────
function AggregationRow({
  agg,
  canRemove,
  dimmed,
  onChange,
  onRemove,
}: {
  agg: AggregationSpec;
  canRemove: boolean;
  dimmed: boolean;
  onChange: (next: AggregationSpec) => void;
  onRemove: () => void;
}) {
  const needsColumn = aggMeta(agg.op).needsColumn;
  return (
    <HStack gap={2} opacity={dimmed ? 0.5 : 1}>
      <NativeSelect.Root size="sm" flex="0 0 auto" width="130px">
        <NativeSelect.Field
          value={agg.op}
          onChange={(e) => {
            const op = e.currentTarget.value as AggregationOp;
            const nextNeedsColumn = aggMeta(op).needsColumn;
            onChange({
              op,
              column: nextNeedsColumn ? agg.column ?? "durationMs" : undefined,
            });
          }}
        >
          {AGGREGATIONS.map((a) => (
            <option key={a.op} value={a.op}>
              {a.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {needsColumn ? (
        <>
          <Text fontSize="sm" color="fg.subtle">
            of
          </Text>
          <NativeSelect.Root size="sm" flex="1">
            <NativeSelect.Field
              value={agg.column ?? "durationMs"}
              onChange={(e) =>
                onChange({ ...agg, column: e.currentTarget.value as MetricColumn })
              }
            >
              {METRICS.map((m) => (
                <option key={m.column} value={m.column}>
                  {m.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </>
      ) : (
        <Box flex="1" />
      )}
      {canRemove ? (
        <Box
          as="button"
          display="flex"
          color="fg.subtle"
          _hover={{ color: "fg" }}
          onClick={onRemove}
        >
          <X size={14} />
        </Box>
      ) : null}
    </HStack>
  );
}
