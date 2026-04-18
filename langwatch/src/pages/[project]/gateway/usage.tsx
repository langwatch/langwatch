import { Box, EmptyState, Text } from "@chakra-ui/react";
import { LineChart } from "lucide-react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

function UsagePage() {
  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Usage</PageLayout.Heading>
        </PageLayout.Header>
        <Box padding={6}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <LineChart size={32} />
              </EmptyState.Indicator>
              <EmptyState.Title>
                Usage dashboards are coming
              </EmptyState.Title>
              <EmptyState.Description>
                Spend by virtual key, project, team, and org — cache hit rate,
                fallback counters, latency percentiles. Sourcing the numbers
                from the ledger + existing analytics pipeline once the Go
                gateway emits per-tenant OTel traces.
              </EmptyState.Description>
              <Text fontSize="sm" color="fg.muted" mt={2}>
                Until then, see existing Analytics for legacy-path spend.
              </Text>
            </EmptyState.Content>
          </EmptyState.Root>
        </Box>
      </PageLayout.Container>
    </GatewayLayout>
  );
}

export default withPermissionGuard("gatewayUsage:view", {
  layoutComponent: DashboardLayout,
})(UsagePage);
