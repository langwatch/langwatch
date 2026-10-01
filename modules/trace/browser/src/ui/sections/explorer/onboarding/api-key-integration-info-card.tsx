import type { PersonalTokenMint } from "@langwatch/api-key-client";
import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import {
  API_KEY_PLACEHOLDER,
  PersonalAccessTokenBanner,
} from "@langwatch/design-system/personal-access-token-banner";
import { VStack } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

import { selfHostedEndpoint } from "../../../../model/explorer/onboarding/self-hosted-endpoint.ts";
import { CLOUD_ENDPOINT } from "../../../../model/onboarding/shared/build-mcp-config.ts";
import { showErrorToast } from "../../errors/index.ts";
import { CodePreview } from "../../onboarding/observability/code-preview.tsx";

interface ApiKeyIntegrationInfoCardProps {
  projectId: string;
  /** Held by the parent, so every setup tab uses the same token instead of minting its own. */
  minting: PersonalTokenMint;
}

interface EnvLine {
  key: string;
  value: string;
  /** Whether this line should be visually highlighted in the preview. */
  highlight?: boolean;
}

function buildEnvLines({
  token,
  projectId,
  endpoint,
  showEndpoint,
}: {
  token: string;
  projectId: string;
  endpoint: string;
  showEndpoint: boolean;
}): EnvLine[] {
  // Highlight every line so the whole block reads as "this is what you copy" at a
  // glance — the API key, the project id, and (when self- hosted) the endpoint all
  // matter to get traces flowing.
  const lines: EnvLine[] = [
    { key: "LANGWATCH_API_KEY", value: token, highlight: true },
    { key: "LANGWATCH_PROJECT_ID", value: projectId, highlight: true },
  ];
  if (showEndpoint) {
    lines.push({ key: "LANGWATCH_ENDPOINT", value: endpoint, highlight: true });
  }
  return lines;
}

function renderEnv(lines: EnvLine[]): string {
  return lines.map(({ key, value }) => `${key}="${value}"`).join("\n");
}

/**
 * Generate-token card for the traces-v2 empty state. Mints a personal access token on the
 * project, then renders the `LANGWATCH_API_KEY` / `LANGWATCH_PROJECT_ID`
 * / `LANGWATCH_ENDPOINT` env block exactly once.
 */
export function ApiKeyIntegrationInfoCard({ projectId, minting }: ApiKeyIntegrationInfoCardProps) {
  const token = minting.token ?? null;
  // Mirror the onboarding ApiIntegrationInfoCard / codegen logic: only
  // surface LANGWATCH_ENDPOINT on a self-hosted deployment.
  const selfHosted = selfHostedEndpoint(useUiDeployment().appBaseUrl);
  const endpoint = selfHosted ?? CLOUD_ENDPOINT;
  const showEndpoint = !!selfHosted;

  // Default to revealed: this token is shown exactly once, so the whole
  // point of the card is to let the user copy it. Masking it by default
  // ("sk-l***...***rKF") just gets in the way. The eye toggle still lets
  // them hide it again.
  const [revealed, setRevealed] = useState(true);

  const handleGenerate = () => {
    minting
      .mint()
      .catch((error: unknown) =>
        showErrorToast({ error, fallbackTitle: "Couldn't create the personal access token" }),
      );
  };

  // `G` triggers Generate when the button is on screen.
  const handleGenerateRef = useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;
  useEffect(() => {
    if (token || minting.isMinting) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) {
        return;
      }
      if (e.key.toLowerCase() === "g") {
        e.preventDefault();
        handleGenerateRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [token, minting.isMinting]);

  const realLines = buildEnvLines({
    token: token ?? API_KEY_PLACEHOLDER,
    projectId,
    endpoint,
    showEndpoint,
  });
  const code = renderEnv(realLines);
  const highlightLines = realLines.map((l, i) => (l.highlight ? i + 1 : -1)).filter((n) => n > 0);

  return (
    <VStack align="stretch" gap={3}>
      <PersonalAccessTokenBanner
        token={token}
        isCreating={minting.isMinting}
        onCreate={handleGenerate}
        scopeNote={minting.scopeNote}
      />
      <CodePreview
        code={code}
        filename=".env"
        codeLanguage="bash"
        highlightLines={token ? highlightLines : []}
        sensitiveValue={token ?? undefined}
        enableVisibilityToggle={!!token}
        isVisible={revealed}
        onToggleVisibility={() => setRevealed((v) => !v)}
        disableActions={!token}
      />
    </VStack>
  );
}
