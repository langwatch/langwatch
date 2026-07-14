import { Box, HStack, Stack } from "@chakra-ui/react";

type WireKind =
  | "header"
  | "context"
  | "md"
  | "section"
  | "bullet"
  | "divider"
  | "fields"
  | "spark"
  | "quote"
  | "table"
  | "card"
  | "chart"
  | "pie"
  | "alertSuccess"
  | "alertWarning"
  | "alertError";

const SPARK_HEIGHTS = ["1.5", "1", "2", "1.5", "2.5", "2", "3"];
const CHART_HEIGHTS = ["1", "1.5", "1.5", "2", "2.5", "3", "3.5"];

// A coloured `alert` banner keyed to its level — the tinted background + accent
// rule reads as Slack's success/warning/error alert block.
function AlertBanner({ palette }: { palette: "green" | "orange" | "red" }) {
  return (
    <Box
      bg={`${palette}.subtle`}
      borderLeftWidth="3px"
      borderLeftColor={`${palette}.solid`}
      borderRadius="xs"
      px="1.5"
      py="1"
    >
      <Box h="2" bg={`${palette}.fg`} borderRadius="xs" w="70%" opacity={0.7} />
    </Box>
  );
}

function Wire({ kind }: { kind: WireKind }) {
  switch (kind) {
    case "header":
      return <Box h="3" bg="fg" borderRadius="xs" w="80%" />;
    case "context":
      return <Box h="1.5" bg="fg.muted" borderRadius="xs" w="60%" />;
    case "section":
      return <Box h="2.5" bg="fg.muted" borderRadius="xs" w="90%" />;
    case "bullet":
      // One matched trace inside a digest — dot + line so the repeated
      // rows read as a list of traces, not paragraphs of one message.
      return (
        <HStack gap="1.5" w="full">
          <Box
            h="1.5"
            w="1.5"
            bg="fg.muted"
            borderRadius="full"
            flexShrink={0}
          />
          <Box h="2" bg="fg.muted" borderRadius="xs" flex="1" />
        </HStack>
      );
    case "md":
      return (
        <Box
          h="4"
          bg="blue.subtle"
          borderLeftWidth="2px"
          borderLeftColor="blue.fg"
          borderRadius="xs"
          w="full"
        />
      );
    case "fields":
      // A two-column section (Slack `fields`) — label/value pairs sitting
      // side by side, as the alert templates use for Metric / Condition.
      return (
        <HStack gap="2" w="full">
          <Box h="2.5" bg="fg.muted" borderRadius="xs" flex="1" />
          <Box h="2.5" bg="fg.muted" borderRadius="xs" flex="1" />
        </HStack>
      );
    case "spark":
      // A tiny bar-sparkline — the trend line the compact alert renders as
      // unicode blocks.
      return (
        <HStack gap="0.5" alignItems="flex-end" h="3">
          {SPARK_HEIGHTS.map((h, i) => (
            <Box key={i} w="1" h={h} bg="fg.muted" borderRadius="xs" />
          ))}
        </HStack>
      );
    case "quote":
      // A rich_text_quote — a left rule with quoted text, the native primitive
      // the rich cards use for Input / Output instead of the markdown hack.
      return (
        <Box
          borderLeftWidth="2px"
          borderLeftColor="border.emphasized"
          pl="1.5"
          w="full"
        >
          <Box h="3" bg="fg.muted" borderRadius="xs" w="85%" />
        </Box>
      );
    case "table":
      // A data_table block — a header row over body rows of cells, the grid the
      // digest / history-table templates render.
      return (
        <Stack gap="0.5" w="full">
          {[0, 1, 2].map((r) => (
            <HStack key={r} gap="0.5" w="full">
              {[0, 1, 2].map((c) => (
                <Box
                  key={c}
                  h="1.5"
                  flex="1"
                  bg={r === 0 ? "fg.muted" : "border"}
                  borderRadius="xs"
                />
              ))}
            </HStack>
          ))}
        </Stack>
      );
    case "card":
      // A card block — an icon tile beside a title / subtitle, over a body line.
      return (
        <Box
          borderWidth="1px"
          borderColor="border.emphasized"
          borderRadius="sm"
          bg="bg.subtle"
          p="1.5"
        >
          <HStack gap="1.5" align="start">
            <Box h="5" w="5" bg="bg.emphasized" borderRadius="xs" flexShrink={0} />
            <Stack gap="1" flex="1">
              <Box h="2.5" bg="fg" borderRadius="xs" w="70%" />
              <Box h="1.5" bg="fg.muted" borderRadius="xs" w="50%" />
            </Stack>
          </HStack>
          <Box h="1.5" bg="fg.muted" borderRadius="xs" w="90%" mt="1.5" />
        </Box>
      );
    case "chart":
      // A data_visualization bar/area chart — rising bars over a baseline axis.
      return (
        <Box borderBottomWidth="1px" borderBottomColor="border" pb="0.5">
          <HStack gap="0.5" alignItems="flex-end" h="8" w="full">
            {CHART_HEIGHTS.map((h, i) => (
              <Box key={i} flex="1" h={h} bg="blue.solid" borderRadius="xs" />
            ))}
          </HStack>
        </Box>
      );
    case "pie":
      // A data_visualization pie chart — a segmented ring.
      return (
        <HStack justify="center" w="full">
          <Box
            h="10"
            w="10"
            borderRadius="full"
            borderWidth="4px"
            borderTopColor="blue.solid"
            borderRightColor="green.solid"
            borderBottomColor="orange.solid"
            borderLeftColor="purple.solid"
          />
        </HStack>
      );
    case "alertSuccess":
      return <AlertBanner palette="green" />;
    case "alertWarning":
      return <AlertBanner palette="orange" />;
    case "alertError":
      return <AlertBanner palette="red" />;
    case "divider":
      return <Box h="px" bg="border" w="full" my="1" />;
  }
}

function WireStack({ rows }: { rows: WireKind[] }) {
  return (
    <Stack gap="1.5" align="stretch">
      {rows.map((kind, i) => (
        <Wire key={i} kind={kind} />
      ))}
    </Stack>
  );
}

export function TraceAlertCompactWireframe() {
  return <WireStack rows={["header", "context", "quote", "quote", "context"]} />;
}

export function TraceAlertOneLinerWireframe() {
  return <WireStack rows={["section"]} />;
}

export function EvalFailureDetailedWireframe() {
  return (
    <WireStack
      rows={["header", "context", "divider", "quote", "quote", "context"]}
    />
  );
}

export function TraceCardRichWireframe() {
  return <WireStack rows={["card", "quote", "quote", "context"]} />;
}

export function EvalFailureRichWireframe() {
  return (
    <WireStack
      rows={["alertError", "context", "divider", "quote", "quote", "context"]}
    />
  );
}

export function DigestCompactWireframe() {
  return (
    <WireStack
      rows={[
        "header",
        "context",
        "divider",
        "bullet",
        "bullet",
        "bullet",
        "bullet",
        "context",
      ]}
    />
  );
}

export function DigestEvaluatorRollupWireframe() {
  return (
    <WireStack
      rows={["header", "context", "pie", "bullet", "bullet", "context"]}
    />
  );
}

export function DigestInlineRichWireframe() {
  return (
    <WireStack
      rows={[
        "header",
        "context",
        "divider",
        "bullet",
        "quote",
        "quote",
        "divider",
        "bullet",
        "quote",
        "quote",
      ]}
    />
  );
}

export function DigestTableWireframe() {
  return <WireStack rows={["header", "context", "table", "context"]} />;
}

export function GraphAlertCompactWireframe() {
  return (
    <WireStack rows={["header", "fields", "fields", "spark", "context"]} />
  );
}

export function GraphAlertDetailedWireframe() {
  return (
    <WireStack rows={["header", "fields", "chart", "context", "context"]} />
  );
}

export function GraphAlertOneLinerWireframe() {
  return <WireStack rows={["section"]} />;
}

export function GraphAlertResolvedWireframe() {
  return (
    <WireStack rows={["alertSuccess", "section", "fields", "context"]} />
  );
}

export function GraphAlertNoDataWireframe() {
  return <WireStack rows={["alertWarning", "section", "context"]} />;
}

export function GraphAlertHistoryTableWireframe() {
  return <WireStack rows={["header", "fields", "table", "context"]} />;
}

export function ReportDigestWireframe() {
  return (
    <WireStack rows={["header", "context", "bullet", "bullet", "context"]} />
  );
}

export function ReportSummaryCardWireframe() {
  return <WireStack rows={["card", "section", "bullet", "context"]} />;
}

export function ReportTableWireframe() {
  return <WireStack rows={["header", "context", "table", "context"]} />;
}

export function ReportChartWireframe() {
  return (
    <WireStack rows={["header", "context", "chart", "section", "context"]} />
  );
}

export function ReportChartCardWireframe() {
  return <WireStack rows={["card", "chart", "context"]} />;
}

// A dashboard report renders one chart per panel — the wireframe shows the
// repetition, which is the whole point of the layout.
export function ReportDashboardWireframe() {
  return (
    <WireStack
      rows={["header", "context", "chart", "chart", "section", "context"]}
    />
  );
}
