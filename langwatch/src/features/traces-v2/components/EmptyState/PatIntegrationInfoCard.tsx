import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { Key } from "lucide-react";
import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { CodePreview } from "~/features/onboarding/components/sections/observability/CodePreview";
import { CLOUD_ENDPOINT } from "~/features/onboarding/components/sections/shared/build-mcp-config";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

interface PatIntegrationInfoCardProps {
  organizationId: string;
  projectId: string;
  /**
   * The token, when one has been minted. Lifting this to the parent lets
   * the empty-state shell drive every setup tab off the same PAT instead
   * of forcing each path to mint its own.
   */
  token: string | null;
  onTokenGenerated: (token: string) => void;
}

/**
 * Hardcoded scope for the empty-state PAT: project-level MEMBER role —
 * read+write within the active project, nothing else. We don't expose a
 * scope picker here because the goal is one-click provisioning for "send
 * me my first traces"; users who need narrower or broader scopes can mint
 * a custom PAT from Settings → API Keys.
 *
 * TODO(traces-v2): When LangWatch ships a tracing-only custom role we
 * should switch this to `customRoleId = TRACING_RW` for least-privilege.
 * MEMBER is the closest preset that grants traces + prompts read/write.
 */
function buildEmptyStateBindings(projectId: string) {
  return [
    {
      role: TeamUserRole.MEMBER,
      customRoleId: null as string | null,
      scopeType: RoleBindingScopeType.PROJECT,
      scopeId: projectId,
    },
  ];
}

// TODO(traces-v2): Rename this card's generated PAT to something more
// descriptive ("LangWatch Tracing — <projectName>") and let the user supply
// their own name. "Initial API key" is a placeholder so the empty-state
// flow has zero text inputs.
const PAT_NAME = "Initial API key";

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
  // Every line in this block is something the user has to copy into their
  // environment, so all of them get the highlight treatment. ENDPOINT is
  // only emitted (and only highlighted) when self-hosted — on cloud the
  // SDK falls back to the default URL and surfacing the line would just be
  // noise.
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
 * Generate-token card for the traces-v2 empty state. Mints a Personal
 * Access Token scoped to the caller's role bindings, then renders the
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
export function PatIntegrationInfoCard({
  organizationId,
  projectId,
  token,
  onTokenGenerated,
}: PatIntegrationInfoCardProps) {
  const publicEnv = usePublicEnv();
  // Mirror the onboarding ApiIntegrationInfoCard / codegen logic: only
  // surface LANGWATCH_ENDPOINT when BASE_HOST is set AND differs from the
  // cloud default. An empty string falls into "default" too — otherwise we
  // emit `LANGWATCH_ENDPOINT=""`, which silently breaks customer SDKs.
  const baseHost = publicEnv.data?.BASE_HOST;
  const endpoint = baseHost || CLOUD_ENDPOINT;
  const showEndpoint = !!baseHost && baseHost !== CLOUD_ENDPOINT;

  const [revealed, setRevealed] = useState(false);

  const createMutation = api.personalAccessToken.create.useMutation();

  const handleGenerate = () => {
    createMutation.mutate(
      {
        organizationId,
        name: PAT_NAME,
        bindings: buildEmptyStateBindings(projectId),
      },
      {
        onSuccess: (result) => {
          onTokenGenerated(result.token);
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to create token",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  if (token) {
    const lines = buildEnvLines({ token, projectId, endpoint, showEndpoint });
    const code = renderEnv(lines);
    const highlightLines = lines
      .map((l, i) => (l.highlight ? i + 1 : -1))
      .filter((n) => n > 0);

    return (
      <VStack align="stretch" gap={4}>
        <VStack align="stretch" gap={0.5}>
          <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
            Your access token
          </Text>
          <Text fontSize="xs" color="orange.500" fontWeight="600">
            Copy this token now. You won&apos;t be able to see it again.
          </Text>
        </VStack>
        <Box
          // Recolor shiki's default line highlight to LangWatch's tracing
          // orange. Two systems can land a tint on the highlighted span:
          // shiki's transformer adds `class="highlighted"`, and Chakra's
          // CodeBlock adapter adds `data-highlight=""` (see
          // node_modules/.../code-block/adapters.js). Cover both, plus the
          // `.line` span variant shiki sometimes wraps. Override
          // `background-color` directly — the `background` shorthand
          // alone doesn't beat Chakra's recipe-level token. The negative
          // margin / positive padding stretches the tint to the edge of
          // the code surface so it reads as a row, not a typo.
          //
          // Shiki's bash grammar also paints token-level backgrounds on
          // string values (the PAT, for instance), so we explicitly
          // clear `background` on every descendant span within a
          // highlighted line — otherwise the inner blue/yellow string
          // tint layers on top of the row's orange and you see
          // half-blue lines.
          css={{
            "& [data-highlight], & .highlighted, & .line[data-highlight], & .line.highlighted":
              {
                background: "rgba(237,137,38,0.18) !important",
                backgroundColor: "rgba(237,137,38,0.18) !important",
                borderLeft:
                  "2px solid var(--chakra-colors-orange-500, rgba(237,137,38,0.85)) !important",
                display: "inline-block",
                width: "100%",
                paddingLeft: "calc(1ch - 2px)",
                marginLeft: "-1ch",
                paddingRight: "1ch",
                marginRight: "-1ch",
              },
            "& [data-highlight] *, & .highlighted *, & .line[data-highlight] *, & .line.highlighted *":
              {
                background: "transparent !important",
                backgroundColor: "transparent !important",
              },
          }}
        >
          <CodePreview
            code={code}
            filename=".env"
            codeLanguage="bash"
            highlightLines={highlightLines}
            sensitiveValue={token}
            enableVisibilityToggle
            isVisible={revealed}
            onToggleVisibility={() => setRevealed((v) => !v)}
          />
        </Box>
        <Text fontSize="xs" color="fg.muted" lineHeight="tall">
          We&apos;ve pre-filled this token into the setup steps below. The
          highlighted lines are the ones to copy into your environment.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={4}>
      <VStack align="stretch" gap={0.5}>
        <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
          Generate an access token
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="tall">
          Creates a Personal Access Token scoped to read and write traces and
          prompts on this project. We&apos;ll plumb it into every setup option
          below.
        </Text>
      </VStack>
      <HStack>
        <Button
          size="sm"
          colorPalette="orange"
          onClick={handleGenerate}
          loading={createMutation.isLoading}
        >
          <Key size={14} />
          Generate access token
        </Button>
      </HStack>
    </VStack>
  );
}
