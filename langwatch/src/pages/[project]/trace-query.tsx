import {
  Box,
  Button,
  Code,
  Heading,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AGGREGATION_OPS,
  DIMENSION_COLUMNS,
  METRIC_COLUMNS,
} from "~/server/app-layer/traces/trace-query/schema";
import { api } from "~/utils/api";

/**
 * SPIKE #5670 — read-only, tenant-isolated trace query surface (prototype).
 *
 * A deliberately minimal surface: pick an aggregation, an optional group-by
 * dimension, an optional liqe filter and a time window, run it, and see both
 * the results AND the compiled SQL — so the compiler-injected `TenantId`
 * scope is visible. Every option below is an allowlist enum from the compiler;
 * there is no free-form column/SQL input. This validates the approach on real
 * seeded trace data end-to-end.
 */
const OP_KEYS = Object.keys(AGGREGATION_OPS) as Array<
  keyof typeof AGGREGATION_OPS
>;
const METRIC_KEYS = Object.keys(METRIC_COLUMNS) as Array<
  keyof typeof METRIC_COLUMNS
>;
const DIMENSION_KEYS = Object.keys(DIMENSION_COLUMNS) as Array<
  keyof typeof DIMENSION_COLUMNS
>;

const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #CBD5E0",
  background: "white",
  color: "black",
};

function Page() {
  const { project } = useOrganizationTeamProject();
  const [op, setOp] = useState<keyof typeof AGGREGATION_OPS>("count");
  const [metric, setMetric] =
    useState<keyof typeof METRIC_COLUMNS>("durationMs");
  const [groupBy, setGroupBy] = useState<string>("model");
  const [filter, setFilter] = useState<string>("");
  const [days, setDays] = useState<number>(30);

  const run = api.traceQuery.run.useMutation();

  const needsColumn = AGGREGATION_OPS[op].needsColumn;

  const onRun = () => {
    if (!project) return;
    const now = Date.now();
    run.mutate({
      projectId: project.id,
      query: {
        aggregations: [
          { op, ...(needsColumn ? { column: metric } : {}), alias: "value" },
        ],
        groupBy: groupBy === "none" ? undefined : [groupBy as never],
        filter: filter.trim() ? filter.trim() : undefined,
        timeRange: { from: now - days * 86_400_000, to: now },
        limit: 100,
      },
    });
  };

  const rows = run.data?.rows ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];

  return (
    <DashboardLayout>
      <VStack align="stretch" gap={5} padding={6} maxWidth="960px">
        <Box>
          <Heading size="lg">Trace Query (spike #5670)</Heading>
          <Text color="gray.500" fontSize="sm">
            Read-only, tenant-isolated aggregation over your trace data. Every
            field is an allowlisted enum; the tenant scope is injected by the
            compiler and cannot be removed.
          </Text>
        </Box>

        <HStack gap={3} wrap="wrap" align="end">
          <label>
            <Text fontSize="xs" color="gray.500">
              Aggregation
            </Text>
            <select
              style={selectStyle}
              value={op}
              onChange={(e) =>
                setOp(e.target.value as keyof typeof AGGREGATION_OPS)
              }
            >
              {OP_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          {needsColumn && (
            <label>
              <Text fontSize="xs" color="gray.500">
                Metric
              </Text>
              <select
                style={selectStyle}
                value={metric}
                onChange={(e) =>
                  setMetric(e.target.value as keyof typeof METRIC_COLUMNS)
                }
              >
                {METRIC_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <Text fontSize="xs" color="gray.500">
              Group by
            </Text>
            <select
              style={selectStyle}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            >
              <option value="none">(none)</option>
              {DIMENSION_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <label>
            <Text fontSize="xs" color="gray.500">
              Filter (liqe)
            </Text>
            <Input
              size="sm"
              width="220px"
              placeholder="e.g. cost:>0.1"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>

          <label>
            <Text fontSize="xs" color="gray.500">
              Last N days
            </Text>
            <Input
              size="sm"
              width="90px"
              type="number"
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 30)}
            />
          </label>

          <Button colorPalette="orange" onClick={onRun} loading={run.isPending}>
            Run
          </Button>
        </HStack>

        {run.error && (
          <Box
            background="red.50"
            color="red.700"
            padding={3}
            borderRadius={6}
            fontSize="sm"
          >
            {run.error.message}
          </Box>
        )}

        {run.data && (
          <VStack align="stretch" gap={3}>
            <Text fontSize="sm" color="gray.500">
              {run.data.rowCount} row(s)
            </Text>
            <Box overflowX="auto" borderWidth="1px" borderRadius={6}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c}
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          borderBottom: "1px solid #E2E8F0",
                          fontSize: 13,
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td
                          key={c}
                          style={{
                            padding: "8px 12px",
                            borderBottom: "1px solid #F1F5F9",
                            fontSize: 13,
                          }}
                        >
                          {String((r as Record<string, unknown>)[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>

            <Box>
              <Text fontSize="xs" color="gray.500" marginBottom={1}>
                Compiled SQL (note the compiler-injected{" "}
                <code>TenantId = &#123;tenantId:String&#125;</code> scope):
              </Text>
              <Code
                display="block"
                whiteSpace="pre-wrap"
                padding={3}
                borderRadius={6}
                fontSize="xs"
              >
                {run.data.sql}
              </Code>
            </Box>
          </VStack>
        )}
      </VStack>
    </DashboardLayout>
  );
}

export default Page;
