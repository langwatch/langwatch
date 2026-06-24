import { Box, HStack, Stack } from "@chakra-ui/react";

type WireKind = "header" | "context" | "md" | "section" | "bullet" | "divider";

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
