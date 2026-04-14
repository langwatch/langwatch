import { useState } from "react";
import { Box, Card, Collapsible, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { api } from "~/utils/api";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { ReplayProgressDrawer } from "~/components/ops/ReplayProgressDrawer";
import { ReplayStatusBanner } from "./ReplayStatusBanner";
import { ReplayHistoryTable } from "./ReplayHistoryTable";
import { BulkReplayWizard } from "./BulkReplayWizard";
import { SingleAggregateReplay } from "./SingleAggregateReplay";

export function ReplayWizardContent() {
  const { canManage } = useOpsPermission();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const projectionsQuery = api.ops.listProjections.useQuery();
  const projections = projectionsQuery.data?.projections ?? [];

  return (
    <>
      <VStack align="stretch" gap={4}>
        <ReplayStatusBanner />

        <BulkReplayWizard onReplayStarted={() => setDrawerOpen(true)} />

        {canManage && projections.length > 0 && (
          <Collapsible.Root
            open={advancedOpen}
            onOpenChange={(e) => setAdvancedOpen(e.open)}
          >
            <Collapsible.Trigger asChild>
              <Box cursor="pointer" userSelect="none">
                <HStack gap={2} paddingY={1}>
                  <Text textStyle="xs" fontWeight="medium" color="fg.muted">
                    Advanced: Single Aggregate Replay
                  </Text>
                  <ChevronDown
                    size={12}
                    style={{
                      transform: advancedOpen ? "rotate(180deg)" : "none",
                      transition: "transform 0.15s",
                    }}
                  />
                </HStack>
              </Box>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <Card.Root marginTop={2}>
                <Card.Body padding={4}>
                  <SingleAggregateReplay
                    projections={projections}
                    onReplayStarted={() => setDrawerOpen(true)}
                  />
                </Card.Body>
              </Card.Root>
            </Collapsible.Content>
          </Collapsible.Root>
        )}

        <ReplayHistoryTable />
      </VStack>
      <ReplayProgressDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
