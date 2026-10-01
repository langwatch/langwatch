import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { API_KEY_PLACEHOLDER } from "@langwatch/design-system/personal-access-token-banner";
import { Text, VStack } from "@langwatch/design-system/primitives";
import type React from "react";

import { useOnboardingHost } from "../../../model/onboarding-host.ts";
import { CLOUD_ENDPOINT } from "../../../model/shared/build-mcp-config.ts";
import { CopyableInputWithPrefix } from "../../elements/observability/copyable-input-with-prefix.tsx";
import { useActiveProject } from "../active-project-context.tsx";
import { ProjectTokenBanner } from "./project-token-banner.tsx";

export function ApiIntegrationInfoCard(): React.ReactElement {
  const host = useOnboardingHost();
  const { freshToken, minting } = useActiveProject();
  const { appBaseUrl } = useUiDeployment();

  const effectiveEndpoint = appBaseUrl;

  const apiKey = freshToken ?? API_KEY_PLACEHOLDER;

  async function copyApiKey({ withBashPrefix }: { withBashPrefix?: boolean }): Promise<void> {
    await host.copyToClipboard({
      text: withBashPrefix ? `LANGWATCH_API_KEY=${apiKey}` : apiKey,
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
          {"A personal access token is shown once. Create a new one anytime."}
        </Text>
      </VStack>
      {minting ? <ProjectTokenBanner minting={minting} /> : null}
      <CopyableInputWithPrefix
        prefix="LANGWATCH_API_KEY="
        value={apiKey}
        ariaLabel="Your API key"
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
