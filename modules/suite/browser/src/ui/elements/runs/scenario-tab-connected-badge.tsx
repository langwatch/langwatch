import { Box, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";

/**
 * Quiet marker on the tab the SDK opened: scenario runs started on this machine
 * land here instead of opening another browser tab. Purely informative, the
 * steering itself happens through the SSE subscription.
 */
export function ScenarioTabConnectedBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <Tooltip
      showArrow
      content={
        <Box maxWidth="280px" data-testid="scenario-tab-connected-popover">
          <Text fontWeight="medium">Connected to your local runs</Text>
          <Text marginTop={1}>
            Scenario runs started on this machine reuse this tab: when a new run starts, this view
            moves to it instead of opening another browser tab.
          </Text>
        </Box>
      }
    >
      <HStack
        data-testid="scenario-tab-connected-badge"
        gap={1.5}
        paddingX={2.5}
        paddingY={1}
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        background="bg.subtle"
        cursor="default"
      >
        <Box
          boxSize={2}
          borderRadius="full"
          background="green.500"
          css={{
            "@keyframes connected-dot": {
              "0%, 100%": {
                boxShadow: "0 0 0 0 var(--chakra-colors-green-300)",
              },
              "50%": { boxShadow: "0 0 0 3px transparent" },
            },
          }}
          animation="connected-dot 2.4s ease-in-out infinite"
        />
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
          Connected to local run
        </Text>
      </HStack>
    </Tooltip>
  );
}
