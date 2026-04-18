import { Box, EmptyState, Text } from "@chakra-ui/react";
import { Gauge } from "lucide-react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

function BudgetsPage() {
  return (
    <GatewayLayout>
      <PageLayout.Container>
        <PageLayout.Header>
          <PageLayout.Heading>Budgets</PageLayout.Heading>
        </PageLayout.Header>
        <Box padding={6}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Gauge size={32} />
              </EmptyState.Indicator>
              <EmptyState.Title>Budgets coming next iteration</EmptyState.Title>
              <EmptyState.Description>
                Hierarchical budgets (org / team / project / virtual-key /
                principal) with calendar-reset windows and block|warn
                on-breach semantics. Schema is already in place and the Go
                gateway's outbox is writing debits — UI controls to create
                and monitor are landing in the next iteration.
              </EmptyState.Description>
              <Text fontSize="sm" color="fg.muted" mt={2}>
                See specs/ai-gateway/budgets.feature for the full scope.
              </Text>
            </EmptyState.Content>
          </EmptyState.Root>
        </Box>
      </PageLayout.Container>
    </GatewayLayout>
  );
}

export default withPermissionGuard("gatewayBudgets:view", {
  layoutComponent: DashboardLayout,
})(BudgetsPage);
