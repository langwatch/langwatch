import { Text, VStack } from "@chakra-ui/react";
import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { CLOUD_ENDPOINT, useActiveProject } from "@langwatch/onboarding-browser-kit";
import type React from "react";

import { useOnboardingHost } from "../../../model/onboarding-host.ts";
import { CopyableInputWithPrefix } from "../../elements/observability/copyable-input-with-prefix.tsx";

export function ApiIntegrationInfoCard(): React.ReactElement {
  const host = useOnboardingHost();
  const { project } = useActiveProject();
  const { appBaseUrl } = useUiDeployment();

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = appBaseUrl;

  async function copyApiKey({ withBashPrefix }: { withBashPrefix?: boolean }): Promise<void> {
    // The clipboard is a browser singleton and the confirmation is the
    // application's, so the host owns both ends: it writes, confirms, and
    // reports a refusal through the same feedback capability every other
    // failure in this package travels on.
    await host.copyToClipboard({
      text: withBashPrefix ? `LANGWATCH_API_KEY=${effectiveApiKey}` : effectiveApiKey,
      succeeded: { title: "Copied", description: "API key copied to clipboard" },
    });
  }

  async function copyEndpoint({ withBashPrefix }: { withBashPrefix?: boolean }): Promise<void> {
    await host.copyToClipboard({
      text: withBashPrefix ? `LANGWATCH_ENDPOINT=${effectiveEndpoint}` : effectiveEndpoint,
      succeeded: { title: "Copied", description: "Endpoint copied to clipboard" },
    });
  }

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0.5}>
        <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
          Your LangWatch Integration Info
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="tall">
          {"You can access your API key again anytime in the project's settings "}
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
       * Mirrors the rule in the empty-state API key card and
       * `buildMcpConfig`: only surface `LANGWATCH_ENDPOINT` when it differs
       * from the public cloud default, via the shared `CLOUD_ENDPOINT`
       * constant so the comparison can't drift between surfaces.
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
