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
  | "table";

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
      // A tiny bar-sparkline — the trend line the alert templates render
      // as unicode blocks.
      return (
        <HStack gap="0.5" alignItems="flex-end" h="3">
          {SPARK_HEIGHTS.map((h, i) => (
            <Box key={i} w="1" h={h} bg="fg.muted" borderRadius="xs" />
          ))}
        </HStack>
      );
    case "quote":
      // A rich_text_quote — a left rule with quoted text, the native primitive
      // the rich trace cards use for Input / Output instead of the markdown hack.
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
      // A table block — a header row over body rows of cells, the grid the
      // digest/history-table templates render (gated on the delivery probe).
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
    case "divider":
      return <Box h="px" bg="border" w="full" my="1" />;
  }
}

const SPARK_HEIGHTS = ["1.5", "1", "2", "1.5", "2.5", "2", "3"];

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
  return <WireStack rows={["header", "context", "md", "md", "context"]} />;
}

export function EvalFailureDetailedWireframe() {
  return (
    <WireStack rows={["header", "context", "divider", "md", "md", "context"]} />
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

export function TraceAlertOneLinerWireframe() {
  return <WireStack rows={["section"]} />;
}

export function DigestEvaluatorRollupWireframe() {
  return (
    <WireStack
      rows={["header", "context", "divider", "bullet", "bullet", "context"]}
    />
  );
}

export function GraphAlertCompactWireframe() {
  return (
    <WireStack rows={["header", "fields", "fields", "spark", "context"]} />
  );
}

export function GraphAlertDetailedWireframe() {
  return (
    <WireStack
      rows={[
        "header",
        "fields",
        "fields",
        "spark",
        "divider",
        "bullet",
        "bullet",
        "bullet",
        "context",
      ]}
    />
  );
}

export function GraphAlertOneLinerWireframe() {
  return <WireStack rows={["section"]} />;
}

export function DigestInlineRichWireframe() {
  return (
    <WireStack
      rows={[
        "header",
        "context",
        "divider",
        "bullet",
        "md",
        "md",
        "divider",
        "bullet",
        "md",
        "md",
      ]}
    />
  );
}

export function GraphAlertResolvedWireframe() {
  return (
    <WireStack rows={["header", "section", "fields", "context", "context"]} />
  );
}

export function GraphAlertNoDataWireframe() {
  return <WireStack rows={["header", "section", "context", "context"]} />;
}

export function GraphAlertHistoryTableWireframe() {
  return <WireStack rows={["header", "fields", "table", "context"]} />;
}

export function TraceCardRichWireframe() {
  return (
    <WireStack rows={["header", "context", "quote", "quote", "context"]} />
  );
}

export function EvalFailureRichWireframe() {
  return (
    <WireStack
      rows={["header", "context", "divider", "quote", "quote", "context"]}
    />
  );
}

export function DigestTableWireframe() {
  return <WireStack rows={["header", "context", "table", "context"]} />;
}
