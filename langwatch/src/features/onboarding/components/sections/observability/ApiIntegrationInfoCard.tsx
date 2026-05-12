import { Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { toaster } from "../../../../../components/ui/toaster";
import { useActiveProject } from "../../../contexts/ActiveProjectContext";
import { CLOUD_ENDPOINT } from "../shared/build-mcp-config";
import { CopyableInputWithPrefix } from "./CopyableInputWithPrefix";

export function ApiIntegrationInfoCard(): React.ReactElement {
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST ?? "";

  async function copyApiKey({
    withBashPrefix,
  }: {
    withBashPrefix?: boolean;
  }): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        withBashPrefix
          ? `LANGWATCH_API_KEY=${effectiveApiKey}`
          : effectiveApiKey,
      );
      toaster.create({
        title: "Copied",
        description: "API key copied to clipboard",
        type: "success",
        meta: { closable: true },
      });
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy the API key. Please try again.",
        type: "error",
        meta: { closable: true },
      });
    }
  }

  async function copyEndpoint({
    withBashPrefix,
  }: {
    withBashPrefix?: boolean;
  }): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        withBashPrefix
          ? `LANGWATCH_ENDPOINT=${effectiveEndpoint}`
          : effectiveEndpoint,
      );
      toaster.create({
        title: "Copied",
        description: "Endpoint copied to clipboard",
      });
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy the endpoint. Please try again.",
        type: "error",
        meta: { closable: true },
      });
    }
  }

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0.5}>
        <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
          Your LangWatch Integration Info
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="tall">
          {
            "You can access your API key again anytime in the project's settings "
          }
          {"page."}
        </Text>
      </VStack>
      <CopyableInputWithPrefix
        prefix="LANGWATCH_API_KEY="
        value={effectiveApiKey}
        ariaLabel="Your API key"
        showVisibilityToggle={true}
        onCopy={copyApiKey}
      />

      {/*
       * Mirror the rule used by the empty-state PAT card and
       * `buildMcpConfig`: only surface `LANGWATCH_ENDPOINT` when the
       * deployment differs from the public cloud default. Cloud users
       * never need this in their .env (it's the SDK's default), and
       * shipping it here would make a no-op line look like a required
       * value. Routed through the shared `CLOUD_ENDPOINT` constant so
       * the cloud comparison can never drift between surfaces.
       */}
      {effectiveEndpoint && effectiveEndpoint !== CLOUD_ENDPOINT && (
        <CopyableInputWithPrefix
          prefix="LANGWATCH_ENDPOINT="
          value={effectiveEndpoint}
          ariaLabel="Your LangWatch Endpoint"
          showVisibilityToggle={false}
          onCopy={copyEndpoint}
        />
      )}
    </VStack>
  );
}
