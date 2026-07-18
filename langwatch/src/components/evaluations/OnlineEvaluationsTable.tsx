import {
  Badge,
  Box,
  HStack,
  IconButton,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  LuChartNoAxesCombined,
  LuCopy,
  LuEllipsis,
  LuPause,
  LuPencil,
  LuPlay,
  LuTrash,
} from "react-icons/lu";

import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { getEvaluatorDefinitions } from "~/server/evaluations/getEvaluator";

import { ListTable } from "../ui/ListTable";
import { Menu } from "../ui/menu";

export type OnlineEvaluationPerformance = {
  metric: "score" | "pass_rate";
  points: number[];
  current: number | null;
  previous: number | null;
};

export type OnlineEvaluationRow = {
  id: string;
  name: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  performance?: OnlineEvaluationPerformance;
};

type OnlineEvaluationsTableProps = {
  projectSlug: string;
  rows: OnlineEvaluationRow[];
  canManage: boolean;
  canViewAnalytics: boolean;
  onEdit: (monitorId: string) => void;
  onReplicate: (monitorId: string) => void;
  onToggle: (monitorId: string) => void;
  onDelete: (monitorId: string) => void;
};

const analyticsHref = (projectSlug: string, monitorId: string) =>
  `/${projectSlug}/analytics/evaluations?evaluationId=${encodeURIComponent(
    monitorId,
  )}`;

export const OnlineEvaluationsTable = ({
  projectSlug,
  rows,
  canManage,
  canViewAnalytics,
  onEdit,
  onReplicate,
  onToggle,
  onDelete,
}: OnlineEvaluationsTableProps) => (
  <ListTable width="full">
    <Table.Header>
      <Table.Row>
        <Table.ColumnHeader width="32%">Online evaluation</Table.ColumnHeader>
        <Table.ColumnHeader width="15%">Mode</Table.ColumnHeader>
        <Table.ColumnHeader width="13%">Status</Table.ColumnHeader>
        <Table.ColumnHeader width="35%">
          Performance, last 7 days
        </Table.ColumnHeader>
        <Table.ColumnHeader width="5%" />
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {rows.map((row) => {
        const definition = getEvaluatorDefinitions(row.checkType);
        const href = analyticsHref(projectSlug, row.id);

        return (
          <Table.Row key={row.id}>
            <Table.Cell>
              <LangyContextTarget
                target={{
                  id: `evaluation:${row.id}`,
                  kind: "evaluation",
                  label: `evaluation: ${row.name}`,
                  ref: row.id,
                }}
              >
                <VStack align="start" gap={0.5}>
                  <Text fontWeight="medium">{row.name}</Text>
                  <Text textStyle="xs" color="fg.muted">
                    {definition?.name ?? row.checkType}
                  </Text>
                </VStack>
              </LangyContextTarget>
            </Table.Cell>
            <Table.Cell>
              <Badge
                colorPalette={
                  row.executionMode === "AS_GUARDRAIL" ? "blue" : "teal"
                }
                variant="subtle"
              >
                {row.executionMode === "AS_GUARDRAIL"
                  ? "Guardrail"
                  : "Online evaluation"}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              <HStack gap={2}>
                <Box
                  width="6px"
                  height="6px"
                  borderRadius="full"
                  background={row.enabled ? "green.solid" : "fg.subtle"}
                />
                <Text textStyle="sm">{row.enabled ? "Active" : "Paused"}</Text>
              </HStack>
            </Table.Cell>
            <Table.Cell>
              {canViewAnalytics ? (
                <Box
                  asChild
                  display="inline-flex"
                  width="full"
                  maxWidth="330px"
                  borderRadius="md"
                  paddingY={1}
                  paddingX={2}
                  marginX={-2}
                  textDecoration="none"
                  color="inherit"
                  _hover={{ background: "bg.muted" }}
                >
                  <a href={href} aria-label={`View analytics for ${row.name}`}>
                    <PerformancePreview row={row} />
                  </a>
                </Box>
              ) : (
                <Text textStyle="sm" color="fg.muted">
                  Analytics unavailable
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <IconButton
                    aria-label={`Actions for ${row.name}`}
                    variant="ghost"
                    size="sm"
                  >
                    <LuEllipsis />
                  </IconButton>
                </Menu.Trigger>
                <Menu.Content>
                  {canViewAnalytics && (
                    <Menu.Item value="analytics" asChild>
                      <a href={href}>
                        <LuChartNoAxesCombined />
                        View analytics
                      </a>
                    </Menu.Item>
                  )}
                  {canManage && (
                    <>
                      <Menu.Item value="edit" onClick={() => onEdit(row.id)}>
                        <LuPencil />
                        Edit
                      </Menu.Item>
                      <Menu.Item
                        value="replicate"
                        onClick={() => onReplicate(row.id)}
                      >
                        <LuCopy />
                        Replicate to another project
                      </Menu.Item>
                      <Menu.Item
                        value="toggle"
                        onClick={() => onToggle(row.id)}
                      >
                        {row.enabled ? <LuPause /> : <LuPlay />}
                        {row.enabled ? "Disable" : "Enable"}
                      </Menu.Item>
                      <Menu.Item
                        value="delete"
                        color="red.fg"
                        onClick={() => onDelete(row.id)}
                      >
                        <LuTrash />
                        Delete
                      </Menu.Item>
                    </>
                  )}
                </Menu.Content>
              </Menu.Root>
            </Table.Cell>
          </Table.Row>
        );
      })}
    </Table.Body>
  </ListTable>
);

const PerformancePreview = ({ row }: { row: OnlineEvaluationRow }) => {
  const performance = row.performance;

  if (!performance) {
    return (
      <HStack width="full" gap={4}>
        <Skeleton width="112px" height="38px" />
        <VStack align="start" gap={1}>
          <Skeleton width="48px" height="18px" />
          <Skeleton width="64px" height="14px" />
        </VStack>
      </HStack>
    );
  }

  const { current, previous, metric, points } = performance;
  const delta =
    current !== null && previous !== null ? current - previous : null;
  const trend =
    delta === null || delta === 0 ? "neutral" : delta > 0 ? "up" : "down";
  const trendColor =
    trend === "up" ? "green.fg" : trend === "down" ? "red.fg" : "fg.muted";

  if (current === null) {
    return (
      <HStack width="full" gap={4}>
        <Sparkline points={[]} trend="neutral" name={row.name} />
        <Text textStyle="sm" color="fg.muted" data-trend="neutral">
          No data yet
        </Text>
      </HStack>
    );
  }

  return (
    <HStack width="full" gap={4} justify="space-between">
      <Sparkline points={points} trend={trend} name={row.name} />
      <VStack minWidth="82px" align="start" gap={0}>
        <Text fontWeight="semibold">
          {metric === "pass_rate"
            ? `${Math.round(current * 100)}%`
            : current.toFixed(2)}
        </Text>
        <Text textStyle="xs" color={trendColor} data-trend={trend}>
          {formatTrend(metric, delta)}
        </Text>
      </VStack>
    </HStack>
  );
};

const formatTrend = (
  metric: OnlineEvaluationPerformance["metric"],
  delta: number | null,
) => {
  if (delta === null) return "No comparison";
  if (delta === 0) return "No change";

  const arrow = delta > 0 ? "↑" : "↓";
  const difference = Math.abs(delta);

  return metric === "pass_rate"
    ? `${arrow} ${Math.round(difference * 100)} pp`
    : `${arrow} ${difference.toFixed(2)}`;
};

const Sparkline = ({
  points,
  trend,
  name,
}: {
  points: number[];
  trend: "up" | "down" | "neutral";
  name: string;
}) => {
  const width = 112;
  const height = 38;
  const padding = 3;
  const finitePoints = points.filter(Number.isFinite);
  const min = finitePoints.length > 0 ? Math.min(...finitePoints) : 0;
  const max = finitePoints.length > 0 ? Math.max(...finitePoints) : 1;
  const range = max - min || 1;
  const polyline = finitePoints
    .map((point, index) => {
      const x =
        finitePoints.length === 1
          ? width / 2
          : padding +
            (index / (finitePoints.length - 1)) * (width - padding * 2);
      const y =
        height - padding - ((point - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const stroke =
    trend === "up"
      ? "var(--chakra-colors-green-500)"
      : trend === "down"
        ? "var(--chakra-colors-red-500)"
        : "var(--chakra-colors-gray-400)";

  return (
    <Box width={`${width}px`} height={`${height}px`} flexShrink={0}>
      <svg
        role="img"
        aria-label={`Performance trend for ${name}`}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
      >
        {finitePoints.length > 1 ? (
          <polyline
            points={polyline}
            fill="none"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <line
            x1={padding}
            x2={width - padding}
            y1={height / 2}
            y2={height / 2}
            stroke={stroke}
            strokeWidth="2"
            strokeDasharray="3 4"
          />
        )}
      </svg>
    </Box>
  );
};
