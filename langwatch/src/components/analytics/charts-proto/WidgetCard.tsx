/**
 * charts-proto — a dashboard widget card (PROTOTYPE).
 *
 * The card chrome around the morphing renderer: a drag handle, the widget
 * title, and an overflow menu (edit / duplicate / resize / delete). Sortable via
 * @dnd-kit so cards rearrange on the grid — the "dashboard composition" feel.
 */
import { Badge, Box, Card, Heading, HStack, IconButton, Spacer, Spinner, Text } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef } from "react";
import {
  BarChart2,
  Copy,
  Edit2,
  Grid as GridIcon,
  MoreVertical,
  Trash2,
  TrendingUp,
} from "react-feather";
import { LuTable } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { api } from "~/utils/api";
import type { WidgetSpec } from "./model";
import { buildTraceQueryRequest, rowsToWidgetResult } from "./realData";
import { runStubQuery, type StubWindow } from "./stubData";
import { WidgetRenderer } from "./WidgetRenderer";

/** Grid geometry — one place so the card and the grid agree. */
export const GRID_ROW_HEIGHT = 150;
export const GRID_GAP = 16;
const HEADER_H = 46;
const BODY_PAD = 26;

const WIDTHS = [
  { label: "Quarter", colSpan: 3 },
  { label: "Third", colSpan: 4 },
  { label: "Half", colSpan: 6 },
  { label: "Two-thirds", colSpan: 8 },
  { label: "Full", colSpan: 12 },
];
const HEIGHTS = [
  { label: "Short", rowSpan: 1 },
  { label: "Medium", rowSpan: 2 },
  { label: "Tall", rowSpan: 3 },
];

const vizIcon = (kind: WidgetSpec["visualization"]) => {
  switch (kind) {
    case "table":
      return <LuTable size={15} />;
    case "line":
      return <TrendingUp size={15} />;
    case "stat":
      return <BarChart2 size={15} />;
    default:
      return <BarChart2 size={15} />;
  }
};

interface Props {
  spec: WidgetSpec;
  window: StubWindow;
  projectId: string | undefined;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onResize: (colSpan: number, rowSpan: number) => void;
}

export function WidgetCard({
  spec,
  window: win,
  projectId,
  onEdit,
  onDuplicate,
  onDelete,
  onResize,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: spec.id });

  const stubResult = useMemo(() => runStubQuery(spec, win), [spec, win]);

  // Real data: no time-bucket dimension exists on the real engine yet, so Line
  // is a known gap, not a bug -- surface it honestly instead of rendering a
  // broken/empty chart.
  const realUnsupported = spec.useRealData && spec.visualization === "line";
  const realActive = spec.useRealData && !realUnsupported;

  const realRequest = useMemo(() => buildTraceQueryRequest(spec, win), [spec, win]);
  const requestKey = useMemo(() => JSON.stringify(realRequest), [realRequest]);
  const realRun = api.traceQuery.run.useMutation();
  const lastRunKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!realActive || !projectId) return;
    if (lastRunKeyRef.current === requestKey) return;
    lastRunKeyRef.current = requestKey;
    realRun.mutate({ projectId, query: realRequest });
    // realRun.mutate is intentionally excluded -- re-running on its identity
    // rather than on requestKey would re-fire the real query every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realActive, projectId, requestKey]);

  const realResult = useMemo(
    () => (realRun.data ? rowsToWidgetResult(spec, realRun.data.rows) : null),
    [spec, realRun.data],
  );

  const result = realActive && realResult ? realResult : stubResult;

  const rendererHeight =
    spec.rowSpan * GRID_ROW_HEIGHT +
    (spec.rowSpan - 1) * GRID_GAP -
    HEADER_H -
    BODY_PAD;

  return (
    <Box
      ref={setNodeRef}
      style={{
        gridColumn: `span ${spec.colSpan}`,
        gridRow: `span ${spec.rowSpan}`,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      opacity={isDragging ? 0.4 : 1}
      zIndex={isDragging ? 1 : undefined}
    >
      <Card.Root height="100%" overflow="hidden" variant="outline">
        <Card.Header paddingY={2} paddingX={3}>
          <HStack gap={2}>
            <Box
              {...attributes}
              {...listeners}
              cursor="grab"
              color="fg.subtle"
              _hover={{ color: "fg.muted" }}
              display="flex"
              aria-label="Drag to reorder"
            >
              <GridIcon size={14} />
            </Box>
            <Box color="fg.muted">{vizIcon(spec.visualization)}</Box>
            <Heading size="sm" lineClamp={1}>
              {spec.title}
            </Heading>
            {spec.useRealData ? (
              <Badge colorPalette="green" variant="subtle" size="xs" flexShrink={0}>
                Real data
              </Badge>
            ) : null}
            <Spacer />
            <Menu.Root>
              <Menu.Trigger asChild>
                <IconButton
                  aria-label="Widget options"
                  variant="ghost"
                  size="xs"
                >
                  <MoreVertical size={15} />
                </IconButton>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item value="edit" onClick={onEdit}>
                  <Edit2 size={14} /> Edit query
                </Menu.Item>
                <Menu.Item value="duplicate" onClick={onDuplicate}>
                  <Copy size={14} /> Duplicate
                </Menu.Item>
                <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
                  <Menu.TriggerItem value="width">
                    <GridIcon size={14} /> Width
                  </Menu.TriggerItem>
                  <Menu.Content>
                    {WIDTHS.map((wd) => (
                      <Menu.Item
                        key={wd.label}
                        value={wd.label}
                        onClick={() => onResize(wd.colSpan, spec.rowSpan)}
                      >
                        {wd.label}
                        {spec.colSpan === wd.colSpan ? "  ✓" : ""}
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Root>
                <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
                  <Menu.TriggerItem value="height">
                    <GridIcon size={14} /> Height
                  </Menu.TriggerItem>
                  <Menu.Content>
                    {HEIGHTS.map((ht) => (
                      <Menu.Item
                        key={ht.label}
                        value={ht.label}
                        onClick={() => onResize(spec.colSpan, ht.rowSpan)}
                      >
                        {ht.label}
                        {spec.rowSpan === ht.rowSpan ? "  ✓" : ""}
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Root>
                <Menu.Separator />
                <Menu.Item
                  value="delete"
                  color="fg.error"
                  _hover={{ background: "bg.error", color: "fg.error" }}
                  onClick={onDelete}
                >
                  <Trash2 size={14} /> Delete
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </HStack>
        </Card.Header>
        <Card.Body paddingTop={0} paddingX={3} paddingBottom={3} overflow="hidden">
          {realUnsupported ? (
            <Text fontSize="sm" color="fg.muted" padding={2}>
              Line isn't supported for real data yet — the real query engine has
              no time-bucket dimension. Pick Table, Bar, or Single-stat.
            </Text>
          ) : realActive && realRun.error ? (
            <Text fontSize="sm" color="fg.error" padding={2}>
              Real query failed: {realRun.error.message}
            </Text>
          ) : realActive && !realResult ? (
            <HStack padding={2} color="fg.muted" fontSize="sm">
              <Spinner size="sm" />
              <Text>Querying real trace data…</Text>
            </HStack>
          ) : (
            <WidgetRenderer
              spec={spec}
              result={result}
              height={Math.max(70, rendererHeight)}
            />
          )}
        </Card.Body>
      </Card.Root>
    </Box>
  );
}
