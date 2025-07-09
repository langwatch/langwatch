// src/components/analytics/PromptAnalyticsDrawer.tsx
import { HStack } from "@chakra-ui/react";
import { Tabs } from "@chakra-ui/react";

import { useDrawer } from "./CurrentDrawer";
import { LLMMetrics } from "./LLMMetrics";
import { Drawer } from "./ui/drawer";

import { ReportsContent } from "~/pages/[project]/analytics/reports";
import { EvaluationsContent } from "~/pages/[project]/analytics/evaluations";

export function PromptAnalyticsDrawer({
  promptConfigId,
}: {
  promptConfigId?: string;
}) {
  const { closeDrawer } = useDrawer();

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Drawer.Title>Prompt Analytics</Drawer.Title>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <Tabs.Root defaultValue="llm-metrics" colorPalette="orange">
            <Tabs.List>
              <Tabs.Trigger value="llm-metrics">LLM Metrics</Tabs.Trigger>
              <Tabs.Trigger value="evaluations">Evaluations</Tabs.Trigger>
              <Tabs.Trigger value="custom-reports">Custom Reports</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="llm-metrics">
              <LLMMetrics />
            </Tabs.Content>
            <Tabs.Content value="evaluations">
              <EvaluationsContent />
            </Tabs.Content>
            <Tabs.Content value="custom-reports">
              <ReportsContent />
            </Tabs.Content>
          </Tabs.Root>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
