import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Check } from "lucide-react";

/**
 * A single clickable row on the main drawer summarising one section of
 * the automation (Conditions, Configuration, …). The whole row is the
 * click target — completed sections pick up a green border + tint so
 * the eye can scan for what is still missing.
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
      as="button"
      type="button"
      width="full"
      textAlign="left"
      padding={3}
      borderRadius="md"
      border="1px solid"
      borderColor={complete ? "green.400" : "border"}
      bg={complete ? "green.50" : "bg"}
      _dark={{ bg: complete ? "green.900" : "bg" }}
      opacity={disabled ? 0.6 : 1}
      cursor={disabled ? "not-allowed" : "pointer"}
      onClick={disabled ? undefined : onClick}
      _hover={
        disabled
          ? undefined
          : { borderColor: complete ? "green.500" : "orange.400" }
      }
    >
      <HStack>
        <VStack align="start" gap={0} flex="1" minWidth="0">
          <HStack>
            <Text fontWeight="semibold">{title}</Text>
            {complete ? (
              <Check size={14} color="var(--chakra-colors-green-500)" />
            ) : null}
          </HStack>
          <Text textStyle="sm" color="fg.muted" lineClamp={2}>
            {summary}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
