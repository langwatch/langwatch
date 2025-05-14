import { Box, Card } from "@chakra-ui/react";
import { MessagesTable } from "~/components/messages/MessagesTable";

function ImportFromProductionComponent() {
  return (
    <Card.Root width="full" position="sticky" top={6}>
      <Card.Body width="full" paddingBottom={6}>
        <Box width="full" position="relative">
          <MessagesTable hideTableToggle hideExport />
        </Box>
      </Card.Body>
    </Card.Root>
  );
}

export function ImportFromProduction() {
  return <ImportFromProductionComponent />;
}
