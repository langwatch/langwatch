import { Box, Button, Card, VStack } from "@chakra-ui/react";
import { MessagesTable } from "~/components/messages/MessagesTable";

function ImportFromProductionComponent() {
  return (
    <VStack width="full" gap={3}>
      <Card.Root width="full">
        <Card.Body width="full" paddingBottom={6}>
          <Box width="full" position="relative">
            <MessagesTable hideTableToggle hideExport hideAddToQueue />
          </Box>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

export function ImportFromProduction() {
  return <ImportFromProductionComponent />;
}
