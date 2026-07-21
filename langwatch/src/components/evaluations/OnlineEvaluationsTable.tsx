import {
  Badge,
  Box,
  HStack,
  IconButton,
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
import Link from "~/utils/compat/next-link";

import { ListTable } from "../ui/ListTable";
import { Menu } from "../ui/menu";
import {
  type OnlineEvaluationPerformance,
  PerformancePreview,
} from "./OnlineEvaluationPerformancePreview";

export type { OnlineEvaluationPerformance } from "./OnlineEvaluationPerformancePreview";

export type OnlineEvaluationRow = {
  id: string;
  name: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  performance?: OnlineEvaluationPerformance;
  hasPerformanceError?: boolean;
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
                <Link
                  href={href}
                  aria-label={`View analytics for ${row.name}`}
                  style={{
                    color: "inherit",
                    display: "inline-flex",
                    maxWidth: "330px",
                    textDecoration: "none",
                    width: "100%",
                  }}
                >
                  <Box
                    width="full"
                    borderRadius="md"
                    paddingY={1}
                    paddingX={2}
                    marginX={-2}
                    _hover={{ background: "bg.muted" }}
                  >
                    <PerformancePreview row={row} />
                  </Box>
                </Link>
              ) : (
                <Text textStyle="sm" color="fg.muted">
                  Analytics unavailable
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              {(canViewAnalytics || canManage) && (
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
                        <Link href={href}>
                          <LuChartNoAxesCombined />
                          View analytics
                        </Link>
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
              )}
            </Table.Cell>
          </Table.Row>
        );
      })}
    </Table.Body>
  </ListTable>
);
