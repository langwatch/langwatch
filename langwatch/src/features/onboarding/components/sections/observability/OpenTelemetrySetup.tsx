import React, { useState } from "react";
import { VStack, Text, Separator } from "@chakra-ui/react";
import { CodePreview } from "./CodePreview";
import { useActiveProject } from "../../../contexts/ActiveProjectContext";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { parseSnippet } from "~/features/onboarding/regions/observability/codegen/snippets";

export function OpenTelemetrySetup(): React.ReactElement {
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [isVisible, setIsVisible] = useState(false);

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST ?? "";

  function toggleVisibility(): void {
    setIsVisible((prev) => !prev);
  }

  const envVarsCode = `# Set these environment variables in your application
export OTEL_EXPORTER_OTLP_ENDPOINT="${effectiveEndpoint}/api/public/otel"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=bearer ${effectiveApiKey}"

# Or for the trace-specific endpoint:
# export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${effectiveEndpoint}/api/public/otel/v1/traces"`;

  const { code: collectorCode, highlightLines } = parseSnippet(`receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  batch:

exporters:
  otlphttp:
    endpoint: ${effectiveEndpoint}/api/public/otel # +
    headers:
      Authorization: bearer ${effectiveApiKey} # +

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp]
`);

  return (
    <VStack align="stretch" gap={6} minW={0} w="full">
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          OpenTelemetry Integration
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Choose your preferred setup method below
        </Text>
      </VStack>

      <VStack align="stretch" gap={3}>
        <Text textStyle="md" fontWeight="semibold">
          Environment Variables
        </Text>
        <Text textStyle="sm">
          Configure your application to send traces directly to LangWatch by setting these environment variables.
          This approach works with any OpenTelemetry SDK or library that supports OTLP HTTP export.
        </Text>
        <CodePreview
          code={envVarsCode}
          filename=".env"
          codeLanguage="bash"
          sensitiveValue={effectiveApiKey}
          enableVisibilityToggle={true}
          isVisible={isVisible}
          onToggleVisibility={toggleVisibility}
        />
        <Text textStyle="xs" color="fg.muted">
          Note: LangWatch supports all HTTP/protobuf, HTTP/JSON and gRPC protocols.
        </Text>
      </VStack>

      <Separator />

      <VStack align="stretch" gap={3}>
        <Text textStyle="md" fontWeight="semibold">
          OpenTelemetry Collector
        </Text>
        <Text textStyle="sm">
          Use the OpenTelemetry Collector as an intermediary to receive traces from your application
          and forward them to LangWatch. This is useful for complex deployments or when you need
          additional processing.
        </Text>
        <CodePreview
          code={collectorCode}
          filename="collector-config.yaml"
          languageIconUrl="/images/external-icons/otel.svg"
          codeLanguage="yaml"
          sensitiveValue={effectiveApiKey}
          enableVisibilityToggle={true}
          isVisible={isVisible}
          highlightLines={highlightLines}
          onToggleVisibility={toggleVisibility}
        />
      </VStack>
    </VStack>
  );
}
