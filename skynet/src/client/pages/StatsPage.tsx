import { useState, useMemo } from "react";
import { Box, Text, Table, Thead, Tbody, Tr, Th, Td, Badge, Collapse } from "@chakra-ui/react";
import type { DashboardData, JobNameMetrics } from "../../shared/types.ts";
import { formatLatency, formatRate, formatNumber } from "../utils/formatters.ts";

type SortKey = "jobName" | "pending" | "active" | "completedPerSec" | "latencyP50Ms" | "latencyP99Ms" | "failedPerSec";

const PHASE_BADGE: Record<string, { label: string; color: string }> = {
  commands: { label: "CMD", color: "cyan" },
  projections: { label: "PROJ", color: "green" },
  reactions: { label: "RCT", color: "orange" },
};

function ValueWithPeak({ value, peak }: { value: string; peak: string }) {
  const showPeak = peak !== value && peak !== "—" && peak !== "0/s";
  return (
    <>
      {value}
      {showPeak && (
        <Text as="span" fontSize="9px" color="#4a6a7a" ml={1}>
          pk {peak}
        </Text>
      )}
    </>
  );
}

function SortIndicator({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey; sortDir: "asc" | "desc" }) {
  if (column !== sortKey) return null;
  return <Text as="span" ml={1}>{sortDir === "asc" ? "▲" : "▼"}</Text>;
}

function PipelineSection({ pipelineName, metrics }: { pipelineName: string; metrics: JobNameMetrics[] }) {
  const [open, setOpen] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("jobName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const cycleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "jobName" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const copy = [...metrics];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = av as number;
      const bn = bv as number;
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [metrics, sortKey, sortDir]);

  const thStyle = {
    cursor: "pointer",
    userSelect: "none" as const,
    fontSize: "9px",
    color: "#4a6a7a",
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    borderColor: "rgba(0, 240, 255, 0.1)",
    px: 2,
    py: 1.5,
  };

  return (
    <Box
      mb={4}
      border="1px solid"
      borderColor="rgba(0, 240, 255, 0.15)"
      borderRadius="2px"
      bg="#0a0e17"
    >
      <Box
        px={4}
        py={2}
        cursor="pointer"
        onClick={() => setOpen((v) => !v)}
        _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
        borderBottom={open ? "1px solid" : "none"}
        borderColor="rgba(0, 240, 255, 0.1)"
      >
        <Text
          fontSize="sm"
          fontWeight="600"
          color="#00f0ff"
          textTransform="uppercase"
          letterSpacing="0.1em"
        >
          {open ? "▼" : "▶"} {pipelineName}{" "}
          <Text as="span" fontSize="xs" color="#4a6a7a" fontWeight="400">
            ({metrics.length} job{metrics.length !== 1 ? "s" : ""})
          </Text>
        </Text>
      </Box>

      <Collapse in={open} animateOpacity>
        <Box overflowX="auto">
          <Table size="sm" variant="unstyled">
            <Thead>
              <Tr>
                <Th {...thStyle} w="60px">Phase</Th>
                <Th {...thStyle} onClick={() => cycleSort("jobName")}>
                  Job Name <SortIndicator column="jobName" sortKey={sortKey} sortDir={sortDir} />
                </Th>
                <Th {...thStyle} isNumeric onClick={() => cycleSort("pending")}>
                  Pend <SortIndicator column="pending" sortKey={sortKey} sortDir={sortDir} />
                </Th>
                <Th {...thStyle} isNumeric onClick={() => cycleSort("active")}>
                  Act <SortIndicator column="active" sortKey={sortKey} sortDir={sortDir} />
                </Th>
                <Th {...thStyle} isNumeric onClick={() => cycleSort("completedPerSec")}>
                  Done/s <SortIndicator column="completedPerSec" sortKey={sortKey} sortDir={sortDir} />
                </Th>
                <Th {...thStyle} isNumeric onClick={() => cycleSort("latencyP50Ms")}>
                  p50 <SortIndicator column="latencyP50Ms" sortKey={sortKey} sortDir={sortDir} />
                </Th>
                <Th {...thStyle} isNumeric onClick={() => cycleSort("latencyP99Ms")}>
                  p99 <SortIndicator column="latencyP99Ms" sortKey={sortKey} sortDir={sortDir} />
                </Th>
                <Th {...thStyle} isNumeric onClick={() => cycleSort("failedPerSec")}>
                  Failed/s <SortIndicator column="failedPerSec" sortKey={sortKey} sortDir={sortDir} />
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {sorted.map((m) => {
                const badge = PHASE_BADGE[m.phase] ?? PHASE_BADGE.commands!;
                return (
                  <Tr
                    key={m.jobName}
                    _hover={{ bg: "rgba(0, 240, 255, 0.04)" }}
                    sx={{ "& td": { borderColor: "rgba(0, 240, 255, 0.06)", py: 1.5, px: 2 } }}
                  >
                    <Td>
                      <Badge
                        colorScheme={badge.color}
                        fontSize="9px"
                        px={1.5}
                        py={0}
                        borderRadius="1px"
                        variant="subtle"
                      >
                        {badge.label}
                      </Badge>
                    </Td>
                    <Td>
                      <Text fontSize="xs" color="#c0d8e8" fontFamily="mono">
                        {m.jobName}
                      </Text>
                    </Td>
                    <Td isNumeric>
                      <Text fontSize="xs" color={m.pending > 0 ? "#00f0ff" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatNumber(m.pending)}
                      </Text>
                    </Td>
                    <Td isNumeric>
                      <Text fontSize="xs" color={m.active > 0 ? "#00ff41" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {m.active}
                      </Text>
                    </Td>
                    <Td isNumeric>
                      <Text fontSize="xs" color={m.completedPerSec > 0 ? "#00ff41" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        <ValueWithPeak
                          value={formatRate(m.completedPerSec)}
                          peak={formatRate(m.peakCompletedPerSec)}
                        />
                      </Text>
                    </Td>
                    <Td isNumeric>
                      <Text fontSize="xs" color={m.latencyP50Ms > 0 ? "#00f0ff" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        <ValueWithPeak
                          value={formatLatency(m.latencyP50Ms)}
                          peak={formatLatency(m.peakLatencyP50Ms)}
                        />
                      </Text>
                    </Td>
                    <Td isNumeric>
                      <Text fontSize="xs" color={m.latencyP99Ms > 0 ? "#00f0ff" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        <ValueWithPeak
                          value={formatLatency(m.latencyP99Ms)}
                          peak={formatLatency(m.peakLatencyP99Ms)}
                        />
                      </Text>
                    </Td>
                    <Td isNumeric>
                      <Text fontSize="xs" color={m.failedPerSec > 0 ? "#ff0033" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                        <ValueWithPeak
                          value={formatRate(m.failedPerSec)}
                          peak={formatRate(m.peakFailedPerSec)}
                        />
                      </Text>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      </Collapse>
    </Box>
  );
}

export function StatsPage({ data }: { data: DashboardData }) {
  const grouped = useMemo(() => {
    const map = new Map<string, JobNameMetrics[]>();
    for (const m of data.jobNameMetrics) {
      const list = map.get(m.pipelineName);
      if (list) {
        list.push(m);
      } else {
        map.set(m.pipelineName, [m]);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.jobNameMetrics]);

  return (
    <Box p={6}>
      <Text
        fontSize="xl"
        fontWeight="bold"
        mb={4}
        color="#00f0ff"
        textTransform="uppercase"
        letterSpacing="0.2em"
        textShadow="0 0 15px rgba(0, 240, 255, 0.3)"
      >
        // TELEMETRY MATRIX
      </Text>

      {grouped.length === 0 && (
        <Box
          p={8}
          textAlign="center"
          border="1px solid"
          borderColor="rgba(0, 240, 255, 0.15)"
          borderRadius="2px"
          bg="#0a0e17"
        >
          <Text color="#4a6a7a" fontSize="sm">No jobs observed yet</Text>
        </Box>
      )}

      {grouped.map(([pipelineName, metrics]) => (
        <PipelineSection key={pipelineName} pipelineName={pipelineName} metrics={metrics} />
      ))}
    </Box>
  );
}
