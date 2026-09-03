/**
 * The configuration table: one row per online evaluation or guardrail.
 *
 * MOVED, not copied — `platform/app`'s `components/evaluations/OnlineEvaluationsTable`
 * had exactly one importer, the page in this package now.
 *
 * Two substitutions on the way across, both of them the standing ones:
 * `@langwatch/design-system/list-table` replaces `~/components/ui/ListTable`
 * (which the experiments list still renders), and `ui/elements/monitor-link`
 * replaces `~/utils/compat/next-link`.
 *
 * THE LANGY CONTEXT TARGET DID NOT TRAVEL. `@langwatch/langy-web` is ungoverned
 * and every consumer compiles its source, which needs an `es2023` library and a
 * stylesheet declaration this package would have had to adopt globally — the
 * me, automations and analytics families' refusal, recorded again.
 */

import { Badge, Box, HStack, IconButton, Table, Text, VStack } from "@chakra-ui/react";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import type { OnlineEvaluationPerformance } from "@langwatch/evaluation-contract";
import { getEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import {
  LuChartNoAxesCombined,
  LuCopy,
  LuEllipsis,
  LuPause,
  LuPencil,
  LuPlay,
  LuTrash,
} from "react-icons/lu";

import { MonitorLink } from "../elements/monitor-link";
import { PerformancePreview } from "../elements/online-evaluation-performance-preview";

export type OnlineEvaluationRow = {
  id: string;
  name: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  performance?: OnlineEvaluationPerformance;
  hasPerformanceError?: boolean;
};

export type OnlineEvaluationsTableProps = {
  projectSlug: string;
  rows: readonly OnlineEvaluationRow[];
  canManage: boolean;
  canViewAnalytics: boolean;
  onEdit: (monitorId: string) => void;
  onReplicate: (monitorId: string) => void;
  onToggle: (monitorId: string) => void;
  onDelete: (monitorId: string) => void;
};

/**
 * Analytics for ONE monitor.
 *
 * The id is encoded rather than interpolated raw: a monitor id is a ksuid
 * today, and a filter that silently widened because an id carried an `&` is the
 * kind of thing nobody notices until the numbers are wrong.
 */
export const analyticsHref = (projectSlug: string, monitorId: string) =>
  `/${projectSlug}/analytics/evaluations?evaluationId=${encodeURIComponent(monitorId)}`;

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
        <Table.ColumnHeader width="35%">Performance, last 7 days</Table.ColumnHeader>
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
              <VStack align="start" gap={0.5}>
                <Text fontWeight="medium">{row.name}</Text>
                <Text textStyle="xs" color="fg.muted">
                  {definition?.name ?? row.checkType}
                </Text>
              </VStack>
            </Table.Cell>
            <Table.Cell>
              <Badge
                colorPalette={row.executionMode === "AS_GUARDRAIL" ? "blue" : "teal"}
                variant="subtle"
              >
                {row.executionMode === "AS_GUARDRAIL" ? "Guardrail" : "Online evaluation"}
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
                <MonitorLink
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
                </MonitorLink>
              ) : (
                <Text textStyle="sm" color="fg.muted">
                  Analytics access required
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              {(canViewAnalytics || canManage) && (
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <IconButton aria-label={`Actions for ${row.name}`} variant="ghost" size="sm">
                      <LuEllipsis />
                    </IconButton>
                  </Menu.Trigger>
                  <Menu.Content>
                    {canViewAnalytics && (
                      <Menu.Item value="analytics" asChild>
                        <MonitorLink href={href}>
                          <LuChartNoAxesCombined />
                          View analytics
                        </MonitorLink>
                      </Menu.Item>
                    )}
                    {canManage && (
                      <>
                        <Menu.Item value="edit" onClick={() => onEdit(row.id)}>
                          <LuPencil />
                          Edit
                        </Menu.Item>
                        <Menu.Item value="replicate" onClick={() => onReplicate(row.id)}>
                          <LuCopy />
                          Replicate to another project
                        </Menu.Item>
                        <Menu.Item value="toggle" onClick={() => onToggle(row.id)}>
                          {row.enabled ? <LuPause /> : <LuPlay />}
                          {row.enabled ? "Disable" : "Enable"}
                        </Menu.Item>
                        <Menu.Item value="delete" color="red.fg" onClick={() => onDelete(row.id)}>
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
