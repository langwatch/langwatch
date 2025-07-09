// src/components/analytics/PromptTracesDrawer.tsx
import { HStack, Text } from "@chakra-ui/react";

import { useDrawer } from "./CurrentDrawer";
import { Drawer } from "./ui/drawer";

import { MessagesPageContent } from "~/pages/[project]/messages";

export function PromptTracesDrawer({
  promptConfigId,
}: {
  promptConfigId?: string;
}) {
  const { closeDrawer } = useDrawer();

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="2xl"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Prompt Traces
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <MessagesPageContent />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
