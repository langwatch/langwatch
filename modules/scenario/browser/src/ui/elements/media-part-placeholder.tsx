import { Badge, HStack, Icon, Skeleton, Text } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";

import type { MediaCategory } from "../../model/media-part-source.ts";

const TEST_ID = {
  missing: "media-part-missing",
  error: "media-part-error",
  "not captured": "media-part-not-captured",
} as const;

function unavailableMessage({
  noun,
  state,
  sizeBytes,
}: {
  noun: string;
  state: "missing" | "error" | "not captured";
  sizeBytes?: number;
}): string {
  if (state === "missing") return `This ${noun} is no longer available`;
  if (state === "error") return `This ${noun} could not be loaded`;
  if (sizeBytes !== undefined) {
    return `This ${noun} was too large to capture (${formatBytes(sizeBytes)})`;
  }
  return `This ${noun} was not captured`;
}

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
  const message = unavailableMessage({ noun, state, sizeBytes });

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
