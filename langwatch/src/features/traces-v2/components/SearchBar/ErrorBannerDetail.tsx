import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import type { AiActionError } from "~/server/app-layer/traces/ai-query";

/**
 * Renders a labelled key/value row inside the expandable error banner.
 * Extracted here so it can be shared between `SearchBar` (the banner) and
 * any other surface that needs the same structured-detail layout.
 */
export const DetailRow: React.FC<{
  label: string;
  value: string;
  multiline?: boolean;
}> = ({ label, value, multiline }) => (
  <HStack align="flex-start" gap={2}>
    <Text
      textStyle="2xs"
      color="fg.muted"
      flexShrink={0}
      minWidth="60px"
      textTransform="uppercase"
      letterSpacing="0.04em"
      fontWeight="600"
      paddingTop={0.5}
    >
      {label}
    </Text>
    <Text
      textStyle="xs"
      color="fg"
      fontFamily="mono"
      wordBreak="break-word"
      whiteSpace={multiline ? "pre-wrap" : "normal"}
    >
      {value}
    </Text>
  </HStack>
);

/** Returns true when the error has at least one structured detail field. */
export function hasAiErrorDetails(error: AiActionError): boolean {
  return Boolean(
    error.details &&
      (error.details.provider ||
        error.details.model ||
        error.details.httpStatus !== undefined ||
        error.details.reason ||
        error.details.lastQuery),
  );
}

/** Renders all present structured detail fields for an AI error. */
export const AiErrorDetails: React.FC<{ error: AiActionError }> = ({
  error,
}) => (
  <VStack align="stretch" gap={0.5} width="full">
    {error.details?.httpStatus !== undefined && (
      <DetailRow label="Status" value={String(error.details.httpStatus)} />
    )}
    {error.details?.provider && (
      <DetailRow label="Provider" value={error.details.provider} />
    )}
    {error.details?.model && (
      <DetailRow label="Model" value={error.details.model} />
    )}
    {error.details?.reason && (
      <DetailRow label="Reason" value={error.details.reason} multiline />
    )}
    {error.details?.lastQuery && (
      <DetailRow label="Last query" value={error.details.lastQuery} multiline />
    )}
  </VStack>
);
