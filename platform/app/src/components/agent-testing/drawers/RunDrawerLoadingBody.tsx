/**
 * The skeleton the run drawer reads while the tRPC query for the run record is
 * still on its way.
 *
 * The queued state is a real scenario status; showing it before the record has
 * been fetched would tell the reader "the run is waiting to start" when the
 * truth is only that the app has not read the record yet. This skeleton stands
 * in for that moment: chat bubbles on the left, results column on the right.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { Box, Grid, Skeleton, VStack } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";

/** How wide the results column reads beside the conversation. */
const RESULTS_COLUMN_WIDTH = "310px";

function ConversationSkeleton() {
  return (
    <VStack
      align="stretch"
      gap={3}
      paddingX={4}
      paddingY={3}
      data-testid="run-drawer-loading-conversation"
    >
      <Skeleton height="52px" borderRadius="lg" width="80%" />
      <Skeleton
        height="52px"
        borderRadius="lg"
        width="60%"
        alignSelf="flex-end"
      />
      <Skeleton height="52px" borderRadius="lg" width="70%" />
      <Skeleton
        height="52px"
        borderRadius="lg"
        width="55%"
        alignSelf="flex-end"
      />
    </VStack>
  );
}

function ResultsColumnSkeleton() {
  return (
    <VStack
      align="stretch"
      gap={2.5}
      paddingX={4}
      paddingY={3}
      data-testid="run-drawer-loading-results"
    >
      <Skeleton height="16px" width="140px" />
      <Skeleton height="14px" width="90%" />
      <Skeleton height="14px" width="70%" />
      <Box height={2} />
      <Skeleton height="16px" width="120px" />
      <Skeleton height="14px" width="80%" />
      <Skeleton height="14px" width="60%" />
    </VStack>
  );
}

export function RunDrawerLoadingBody() {
  return (
    <Drawer.Body
      paddingY={0}
      paddingX={0}
      display="flex"
      flexDirection="column"
      width="full"
      height="full"
      overflow="hidden"
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
      data-testid="run-drawer-loading"
    >
      <Drawer.CloseTrigger />
      <Grid
        templateColumns={`minmax(0, 1fr) minmax(0, ${RESULTS_COLUMN_WIDTH})`}
        flex={1}
        minHeight={0}
      >
        <Box style={{ overflowY: "auto" }}>
          <ConversationSkeleton />
        </Box>
        <Box style={{ overflowY: "auto" }}>
          <ResultsColumnSkeleton />
        </Box>
      </Grid>
    </Drawer.Body>
  );
}
