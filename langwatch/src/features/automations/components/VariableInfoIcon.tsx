import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import type { VariableInfo } from "~/features/automations/editors/liquidMonaco";
import { Tooltip } from "~/components/ui/tooltip";

/**
 * Small info icon rendered next to a template-field label. On hover it pops
 * a tooltip listing the variables the author can reference for that field —
 * scoped to the current cadence so the surface stays tight (no
 * `digest.windowStart` when only immediate fires are possible).
 *
 * Replaces the giant "Variable reference" panel that used to live below
 * every template editor.
 */
export function VariableInfoIcon({
  variables,
}: {
  variables: VariableInfo[];
}) {
  return (
    <Tooltip
      openDelay={200}
      content={
        <VStack
          align="stretch"
          gap={1}
          maxHeight="320px"
          overflowY="auto"
          padding={1}
        >
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={1}>
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
      }
    >
      <Box
        as="span"
        color="fg.muted"
        cursor="help"
        display="inline-flex"
        alignItems="center"
      >
        <Info size={13} />
      </Box>
    </Tooltip>
  );
}
