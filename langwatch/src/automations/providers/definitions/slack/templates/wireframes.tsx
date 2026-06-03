import { Box, Stack } from "@chakra-ui/react";

type WireKind = "header" | "context" | "md" | "section" | "divider";

function Wire({ kind }: { kind: WireKind }) {
  switch (kind) {
    case "header":
      return <Box h="3" bg="fg" borderRadius="xs" w="80%" />;
    case "context":
      return <Box h="1.5" bg="fg.muted" borderRadius="xs" w="60%" />;
    case "section":
      return <Box h="2.5" bg="fg.muted" borderRadius="xs" w="90%" />;
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
        "section",
        "section",
        "section",
        "section",
        "context",
      ]}
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
        "context",
        "section",
        "md",
        "md",
        "divider",
        "context",
        "section",
        "md",
      ]}
    />
  );
}
