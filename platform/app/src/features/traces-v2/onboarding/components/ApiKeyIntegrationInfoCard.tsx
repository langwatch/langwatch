import { VStack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { MintApiKeyBanner } from "~/components/api-keys/MintApiKeyBanner";
import { CodePreview } from "~/features/onboarding/components/sections/observability/CodePreview";
import { CLOUD_ENDPOINT } from "~/features/onboarding/components/sections/shared/build-mcp-config";
import { useMintProjectApiKey } from "~/hooks/useMintProjectApiKey";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { selfHostedEndpoint } from "../logic/selfHostedEndpoint";

interface ApiKeyIntegrationInfoCardProps {
  organizationId: string;
  projectId: string;
  /**
   * The token, when one has been minted. Lifting this to the parent lets
   * the empty-state shell drive every setup tab off the same API key instead
   * of forcing each path to mint its own.
   */
  token: string | null;
  onTokenGenerated: (token: string) => void;
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
  // Highlight every line so the whole block reads as "this is what you
  // copy" at a glance — the API key, the project id, and (when self-
  // hosted) the endpoint all matter to get traces flowing.
  // `ENDPOINT` is only emitted when self-hosted — on cloud the SDK
  // falls back to the default URL, so surfacing the line at all would
  // just be noise.
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
 * Generate-token card for the traces-v2 empty state. Mints an API key
 * scoped to the caller's role bindings, then renders the
 * `LANGWATCH_API_KEY` / `LANGWATCH_PROJECT_ID` / `LANGWATCH_ENDPOINT`
 * env block exactly once. The parent owns the token so other setup
 * paths (Coding Agent, MCP) can render with the same credential.
 *
 * The env block is rendered through the shared CodePreview so the
 * lines that the user actually needs to act on (`LANGWATCH_API_KEY`,
 * and `LANGWATCH_ENDPOINT` when self-hosted) are highlighted via shiki.
 * `LANGWATCH_ENDPOINT` is omitted entirely when the deployment matches
 * the cloud default — it's a no-op on cloud and adding clutter would
 * obscure the lines that matter.
 */
export function ApiKeyIntegrationInfoCard({
  organizationId,
  projectId,
  token,
  onTokenGenerated,
}: ApiKeyIntegrationInfoCardProps) {
  const publicEnv = usePublicEnv();
  // Mirror the onboarding ApiIntegrationInfoCard / codegen logic: only
  // surface LANGWATCH_ENDPOINT on a self-hosted deployment.
  const selfHosted = selfHostedEndpoint(publicEnv.data?.BASE_HOST);
  const endpoint = selfHosted ?? CLOUD_ENDPOINT;
  const showEndpoint = !!selfHosted;

  // Default to revealed: this token is shown exactly once, so the whole
  // point of the card is to let the user copy it. Masking it by default
  // ("sk-l***...***rKF") just gets in the way. The eye toggle still lets
  // them hide it again.
  const [revealed, setRevealed] = useState(true);

  const { mint: handleGenerate, isPending } = useMintProjectApiKey({
    organizationId,
    projectId,
    token,
    onToken: onTokenGenerated,
  });

  // `G` triggers Generate when the button is on screen. Skipped when a
  // token is already minted (button disappears) or while another mutation
  // is in flight, and suppressed for typing targets so it doesn't fire
  // when the user is in an input elsewhere on the page.
  //
  // Route through a ref so the handler always invokes the latest closure
  // (organizationId/projectId/onTokenGenerated change → ref updates) without
  // re-binding the listener on every render.
  const handleGenerateRef = useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;
  useEffect(() => {
    if (token || isPending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.tagName === "INPUT" ||
        t?.tagName === "TEXTAREA" ||
        t?.isContentEditable
      ) {
        return;
      }
      if (e.key.toLowerCase() === "g") {
        e.preventDefault();
        handleGenerateRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [token, isPending]);

  // Pre-generation preview shows the .env shape with a non-secret
  // placeholder for the API key. The placeholder is hidden behind a
  // "Generate access token" overlay so the user can't mistakenly
  // copy `sk-lw-xxxxx...` and wonder why their SDK rejects it. The
  // project id and endpoint lines stay readable through the scrim so
  // the shape of the file is still obvious.
  const PLACEHOLDER_TOKEN = "sk-lw-xxxxxxxxxxxxxxxxxxxxxxxx";
  const realLines = buildEnvLines({
    token: token ?? PLACEHOLDER_TOKEN,
    projectId,
    endpoint,
    showEndpoint,
  });
  const code = renderEnv(realLines);
  const highlightLines = realLines
    .map((l, i) => (l.highlight ? i + 1 : -1))
    .filter((n) => n > 0);

  return (
    <VStack align="stretch" gap={3}>
      {/* The single canonical mint CTA for the whole integration surface.
          Both .env and mcp.json fill in from the same shared state, so one
          click is enough. */}
      <MintApiKeyBanner
        token={token}
        onMint={handleGenerate}
        isPending={isPending}
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
