// src/components/analytics/PromptAnalyticsDrawer.tsx
import { HStack } from "@chakra-ui/react";
import { Tabs } from "@chakra-ui/react";

import { useDrawer } from "../CurrentDrawer";
import { Drawer } from "../ui/drawer";

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
              Coming soon {promptConfigId}
            </Tabs.Content>
            <Tabs.Content value="evaluations">
              Coming soon {promptConfigId}
            </Tabs.Content>
            <Tabs.Content value="custom-reports">
              Coming soon {promptConfigId}
            </Tabs.Content>
          </Tabs.Root>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
