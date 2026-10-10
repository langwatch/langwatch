import { Box, HStack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface ResourceRowProps {
  icon?: ReactNode;
  name: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  /** Human-readable provenance, including FormattedDate when appropriate. */
  meta?: ReactNode;
}

/** A compact resource identity and its provenance; no fetching or implicit interaction. */
export function ResourceRow({ icon, name, status, description, meta }: ResourceRowProps) {
  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="lg" padding={3.5}>
      <HStack justify="space-between" gap={2} align="start" flexWrap="wrap">
        <HStack gap={2} minWidth={0}>
          {icon != null && (
            <Box color="fg.muted" flexShrink={0} aria-hidden>
              {icon}
            </Box>
          )}
          <Text fontSize="sm" fontWeight="medium" overflowWrap="anywhere">
            {name}
          </Text>
        </HStack>
        {status}
      </HStack>
      {description != null && (
        <Text fontSize="xs" color="fg.muted" marginTop={2}>
          {description}
        </Text>
      )}
      {meta != null && (
        <Box fontSize="xs" color="fg.muted" marginTop={1} overflowWrap="anywhere">
          {meta}
        </Box>
      )}
    </Box>
  );
}
