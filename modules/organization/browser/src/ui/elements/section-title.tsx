import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** A tab's first heading row: title over hint, and the tab's own action at its end. */
export function SectionTitle({
  title,
  hint,
  right,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** A badge or a control belonging to the group as a whole. */
  right?: ReactNode;
}) {
  return (
    <HStack width="full" align="start" gap={3} paddingBottom={hint ? 2 : 1} as="header">
      <VStack align="start" gap={0.5} minWidth={0} flex={1}>
        <Text as="h3" fontSize="13px" fontWeight="640" letterSpacing="-0.005em" lineHeight="1.35">
          {title}
        </Text>
        {hint && (
          <Text fontSize="11.5px" lineHeight="1.55" color="fg.muted">
            {hint}
          </Text>
        )}
      </VStack>
      {right && <Box flexShrink={0}>{right}</Box>}
    </HStack>
  );
}
