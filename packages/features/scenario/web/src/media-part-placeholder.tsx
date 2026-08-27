import { Badge, HStack, Icon, Skeleton, Text } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import type { MediaCategory } from "./media-part-source";

const TEST_ID = {
  missing: "media-part-missing",
  error: "media-part-error",
  "not captured": "media-part-not-captured",
} as const;

export function MediaUnavailable({
  category,
  state,
  sizeBytes,
}: {
  category: MediaCategory;
  state: "missing" | "error" | "not captured";
  sizeBytes?: number;
}) {
  const noun = category === "binary" ? "file" : category;
  const message =
    state === "missing"
      ? `This ${noun} is no longer available`
      : state === "error"
        ? `This ${noun} could not be loaded`
        : sizeBytes !== undefined
          ? `This ${noun} was too large to capture (${formatBytes(sizeBytes)})`
          : `This ${noun} was not captured`;

  return (
    <HStack
      data-testid={TEST_ID[state]}
      display="inline-flex"
      gap={2}
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      bg="bg.subtle"
      border="1px solid"
      borderColor="border"
    >
      <Icon as={AlertTriangle} boxSize={3.5} color="fg.muted" />
      <Text fontSize="xs" color="fg.muted">
        {message}
      </Text>
      <Badge colorPalette={state === "error" ? "red" : "gray"} size="sm" variant="outline">
        {state}
      </Badge>
    </HStack>
  );
}

export function MediaProbing() {
  return (
    <Skeleton
      data-testid="media-part-probing"
      height="38px"
      width="100%"
      maxWidth="400px"
      borderRadius="md"
    />
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)}B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)}${units[unitIndex]}`;
}
