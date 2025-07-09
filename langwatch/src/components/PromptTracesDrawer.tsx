// src/components/analytics/PromptTracesDrawer.tsx
import { HStack, Text, VStack, Card, Heading, Alert } from "@chakra-ui/react";
import { useDrawer } from "../CurrentDrawer";
import { Drawer } from "../ui/drawer";

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
            <Text paddingTop={5} fontSize="2xl">
              Prompt Traces
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack width="full" align="start" gap={4}>
            <Card.Root>
              <Card.Header>
                <Heading size="sm">Recent Traces</Heading>
              </Card.Header>
              <Card.Body>
                <Alert.Root status="info">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Coming Soon</Alert.Title>
                    <Alert.Description>
                      Traces for this prompt config will be displayed here. This
                      feature is currently in development.
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              </Card.Body>
            </Card.Root>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
