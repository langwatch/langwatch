import { Box, HoverCard, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import type { VariableInfo } from "~/features/automations/editors/liquidMonaco";

/**
 * Small info icon rendered next to a template-field label. On hover it opens
 * a HoverCard listing the variables the author can reference for that field,
 * scoped to the current cadence so the surface stays tight (no
 * `digest.windowStart` when only immediate fires are possible).
 *
 * HoverCard (rather than Tooltip) so the author can move the cursor *into*
 * the panel to scroll long variable lists without dismissing it. Tooltips
 * dismiss the moment the pointer leaves the trigger, which made the list
 * effectively un-readable past the first few rows.
 */
export function VariableInfoIcon({
  variables,
}: {
  variables: VariableInfo[];
}) {
  return (
    <HoverCard.Root openDelay={150} closeDelay={120}>
      <HoverCard.Trigger asChild>
        <Box
          as="span"
          color="fg.muted"
          cursor="help"
          display="inline-flex"
          alignItems="center"
          _hover={{ color: "fg" }}
        >
          <Info size={13} />
        </Box>
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
            <VStack
              align="stretch"
              gap={2}
              maxHeight="360px"
              overflowY="auto"
            >
              <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
                Available variables
              </Text>
              {variables.map((variable) => (
                <Box key={variable.path}>
                  <HStack gap={2} align="baseline">
                    <Text
                      textStyle="xs"
                      fontFamily="mono"
                      fontWeight="semibold"
                    >
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
