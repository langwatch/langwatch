import { Box, chakra, HoverCard, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import type { VariableInfo } from "@langwatch/automation-contract";

/** Uses an interactive hover card so long variable lists remain scrollable. */
export function VariableInfoIcon({ variables }: { variables: VariableInfo[] }) {
  return (
    <HoverCard.Root openDelay={150} closeDelay={120}>
      <HoverCard.Trigger asChild>
        <chakra.button
          type="button"
          aria-label="Show available variables"
          color="fg.muted"
          cursor="help"
          display="inline-flex"
          alignItems="center"
          bg="transparent"
          border="none"
          p={0}
          _hover={{ color: "fg" }}
        >
          <Info size={13} />
        </chakra.button>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="340px"
            padding={3}
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
          >
            <VStack align="stretch" gap={2} maxHeight="360px" overflowY="auto">
              <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
                Available variables
              </Text>
              {variables.map((variable) => (
                <Box key={variable.path}>
                  <HStack gap={2} align="baseline">
                    <Text textStyle="xs" fontFamily="mono" fontWeight="semibold">
                      {variable.path}
                    </Text>
                    <Text textStyle="xs" color="fg.muted">
                      {variable.type}
                    </Text>
                  </HStack>
                  {variable.description ? (
                    <Text textStyle="xs" color="fg.muted">
                      {variable.description}
                    </Text>
                  ) : null}
                </Box>
              ))}
            </VStack>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}
