import { useDrawer, useDrawerParams } from "@langwatch/browser-host/drawer";
import { Box, Heading, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { Suspense } from "react";

import { HandledErrorAlert } from "../../../behavior/errors.tsx";
import { AgentTestingRunDrawer } from "../agent-testing/drawers/agent-testing-run-drawer.tsx";
import { RunDetailDialogs, RunDetailView } from "./scenario-run-detail-view.tsx";
import { useScenarioRunDetail } from "./use-scenario-run-detail.ts";

/** What a caller hands scenario's run detail drawer; the run itself travels as URL params. */
export type UiScenarioRunDetailDrawerProps = {
  open?: boolean;
};

/**
 * The run detail drawer. The Agent Testing pages open the same registry key
 * with `variant: "agent-testing"`, which renders the wide variant; without it
 * the drawer renders exactly as v1 always has.
 */
export function ScenarioRunDetailDrawer(props: UiScenarioRunDetailDrawerProps) {
  const params = useDrawerParams();
  if (params.variant === "agent-testing") {
    return (
      <Suspense fallback={null}>
        <AgentTestingRunDrawer open={props.open} />
      </Suspense>
    );
  }
  return <ClassicScenarioRunDetailDrawer {...props} />;
}

function RunDetailLoadState({ error }: { error: { data?: { code: string } } | null }) {
  if (!error) {
    return (
      <VStack gap={4} align="start" w="100%" pt={4}>
        <Skeleton height="32px" width="60%" />
        <Skeleton height="24px" width="40%" />
        <Skeleton height="200px" width="100%" borderRadius="md" />
      </VStack>
    );
  }

  if (error.data?.code === "NOT_FOUND") {
    return (
      <VStack gap={2} align="start" w="100%" pt={4}>
        <Drawer.CloseTrigger />
        <Heading size="md">Run details not available yet</Heading>
        <Text color="fg.muted" fontSize="sm">
          This run may be queued, in progress, or recently cancelled. Details will appear once
          available.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack gap={2} align="start" w="100%" pt={4}>
      <Drawer.CloseTrigger />
      <Box width="100%">
        <HandledErrorAlert error={error} fallbackTitle="Failed to load run" />
      </Box>
    </VStack>
  );
}

function ClassicScenarioRunDetailDrawer({ open }: UiScenarioRunDetailDrawerProps) {
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const detail = useScenarioRunDetail({ scenarioRunId: params.scenarioRunId, open: !!open });
  const { scenarioState, runStateError } = detail;

  return (
    <>
      <Drawer.Root
        open={!!open}
        // Only a close is a close; see AgentTestingRunDrawer.
        onOpenChange={({ open: isOpen }) => {
          if (!isOpen) closeDrawer();
        }}
        placement="end"
        size="lg"
      >
        {/* Transparent at the Content level so the header band below can run
            its own translucent + backdrop-blur fill over the drawer's
            scrolling content — same recipe as the Traces V2 drawer shell. */}
        <Drawer.Content
          bg="transparent"
          paddingX={0}
          maxWidth="720px"
          overflow="hidden"
          borderRadius="lg"
        >
          {!scenarioState && open && (
            <Drawer.Body bg={{ base: "bg.surface", _dark: "bg.panel" }}>
              <RunDetailLoadState error={runStateError} />
            </Drawer.Body>
          )}
          {scenarioState && (
            <Drawer.Body
              paddingY={0}
              paddingX={0}
              overflowY="auto"
              display="flex"
              flexDirection="column"
              width="full"
              bg={{ base: "bg.surface", _dark: "bg.panel" }}
            >
              <RunDetailView
                detail={detail}
                scenarioState={scenarioState}
                headerEnd={<Drawer.CloseTrigger />}
              />
            </Drawer.Body>
          )}
        </Drawer.Content>
      </Drawer.Root>

      <RunDetailDialogs detail={detail} />
    </>
  );
}
