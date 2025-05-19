import { Card } from "@chakra-ui/react";
import { MessagesTable } from "~/components/messages/MessagesTable";

function ImportFromProductionComponent() {
  return (
    <Card.Root width="full">
      <Card.Body width="full" padding={0} position="relative">
        <MessagesTable
          hideTableToggle
          hideExport
          hideAddToQueue
          hideAnalyticsToggle
        />
      </Card.Body>
    </Card.Root>
  );
}

export function ImportFromProduction() {
  return <ImportFromProductionComponent />;
}
