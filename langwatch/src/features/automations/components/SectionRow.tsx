import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, ChevronRight } from "lucide-react";

/**
 * A single clickable row on the main drawer summarising one section of
 * the automation. The whole row is the click target. Completed rows get
 * a subtle border accent + check; we no longer wash the row in green
 * because the icon already reads as success at a glance, and the wash
 * makes a half-set drawer feel like a marker-checklist instead of a form.
 */
export function SectionRow({
  title,
  summary,
  complete,
  disabled = false,
  onClick,
}: {
  title: string;
  summary: string;
  complete: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      role="button"
      tabIndex={disabled ? -1 : 0}
      width="full"
      textAlign="left"
      padding={3}
      borderRadius="md"
      border="1px solid"
      borderColor={complete ? "green.400" : "border"}
      bg="bg"
      opacity={disabled ? 0.6 : 1}
      cursor={disabled ? "not-allowed" : "pointer"}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      _hover={
        disabled
          ? undefined
          : { borderColor: complete ? "green.500" : "orange.400" }
      }
    >
      <HStack gap={3}>
        <VStack align="start" gap={0} flex="1" minWidth="0">
          <HStack gap={2}>
            <Text fontWeight="semibold">{title}</Text>
            {complete ? (
              <Check size={14} color="var(--chakra-colors-green-500)" />
            ) : null}
          </HStack>
          <Text textStyle="sm" color="fg.muted" lineClamp={2}>
            {summary}
          </Text>
        </VStack>
        <Box color="fg.muted" flexShrink={0}>
          <ChevronRight size={16} />
        </Box>
      </HStack>
    </Box>
  );
}
