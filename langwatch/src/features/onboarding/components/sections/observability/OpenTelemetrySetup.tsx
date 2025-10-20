import React from "react";
import { VStack, Text, Card, Alert } from "@chakra-ui/react";

export function OpenTelemetrySetup(): React.ReactElement {
  return (
    <VStack align="stretch" gap={3}>
      <Card.Root>
        <Card.Header>
          <Text fontWeight="semibold">Instrument your services with OpenTelemetry</Text>
        </Card.Header>
        <Card.Body>
          <VStack align="stretch" gap={2}>
            <Text fontSize="sm">Use your existing OTel tracers and exporters. Then enable LangWatch ingestion by configuring the exporter endpoint and service name.</Text>
            <Alert.Root borderStartWidth="4px" borderStartColor="colorPalette.solid">
              <Alert.Content>
                <Alert.Description>
                  Configure the OTLP exporter to point to your LangWatch collector and set the <code>N8N_OTEL_SERVICE_NAME</code> (or equivalent) to your project name.
                </Alert.Description>
              </Alert.Content>
            </Alert.Root>
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}
