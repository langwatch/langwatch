import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { Key, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { CodePreview } from "~/features/onboarding/components/sections/observability/CodePreview";
import { CLOUD_ENDPOINT } from "~/features/onboarding/components/sections/shared/build-mcp-config";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";

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

/**
 * Hardcoded scope for the empty-state API key: project-level MEMBER role —
 * read+write within the active project, nothing else. We don't expose a
 * scope picker here because the goal is one-click provisioning for "send
 * me my first traces"; users who need narrower or broader scopes can mint
 * a custom API key from Settings → API Keys.
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

// TODO(traces-v2): Rename this card's generated key to something more
// descriptive ("LangWatch Tracing — <projectName>") and let the user supply
// their own name. "Initial API key" is a placeholder so the empty-state
// flow has zero text inputs.
const API_KEY_NAME = "Initial API key";

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
  // Only the API key line gets the highlight treatment — the project id
  // and endpoint are already known to the user (project id is shown in
  // the URL, endpoint defaults are obvious). Highlighting every line
  // dilutes the hint and turns the block into a wall of orange.
  // `ENDPOINT` is only emitted when self-hosted — on cloud the SDK
  // falls back to the default URL, so surfacing the line at all would
  // just be noise.
  const lines: EnvLine[] = [
    { key: "LANGWATCH_API_KEY", value: token, highlight: true },
    { key: "LANGWATCH_PROJECT_ID", value: projectId },
  ];
  if (showEndpoint) {
    lines.push({ key: "LANGWATCH_ENDPOINT", value: endpoint });
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
  // surface LANGWATCH_ENDPOINT when BASE_HOST is set AND differs from the
  // cloud default. An empty string falls into "default" too — otherwise we
  // emit `LANGWATCH_ENDPOINT=""`, which silently breaks customer SDKs.
  const baseHost = publicEnv.data?.BASE_HOST;
  const endpoint = baseHost || CLOUD_ENDPOINT;
  const showEndpoint = !!baseHost && baseHost !== CLOUD_ENDPOINT;

  const [revealed, setRevealed] = useState(false);

  const createMutation = api.apiKey.create.useMutation();

  const handleGenerate = () => {
    createMutation.mutate(
      {
        organizationId,
        name: API_KEY_NAME,
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
    if (token || createMutation.isLoading) return;
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
  }, [token, createMutation.isLoading]);

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
      {/* Slim, full-width, subtly orange banner sitting directly above
          the .env code block — this is the single canonical mint CTA
          for the whole integration surface. It transforms in place
          after the user mints, becoming the "copy this token now"
          advisory + Mint-another link. Both .env and mcp.json fill in
          from the same shared state, so one click is enough. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={token ? "post-gen" : "pre-gen"}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          {token ? (
            <Box
              borderWidth="1px"
              borderColor="orange.muted"
              borderRadius="lg"
              bg="orange.subtle"
              paddingX={4}
              paddingY={3}
            >
              <HStack justify="space-between" align="center" gap={3}>
                <HStack gap={2} align="center" color="fg" flex={1} minWidth={0}>
                  <Icon
                    as={Sparkles}
                    boxSize={4}
                    color="orange.fg"
                    flexShrink={0}
                  />
                  <Text fontSize="sm" lineHeight="snug">
                    <Text as="span" color="orange.fg" fontWeight="semibold">
                      Copy this token before you move on.
                    </Text>{" "}
                    <Text as="span" color="fg.muted">
                      It won&apos;t be shown again.
                    </Text>
                  </Text>
                </HStack>
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="orange"
                  onClick={handleGenerate}
                  loading={createMutation.isLoading}
                  flexShrink={0}
                >
                  <Key size={12} />
                  Mint another
                </Button>
              </HStack>
            </Box>
          ) : (
            <Box
              borderWidth="1px"
              borderColor="orange.muted"
              borderRadius="lg"
              bg="orange.subtle"
              paddingX={4}
              paddingY={3}
            >
              <HStack justify="space-between" align="center" gap={3}>
                <HStack gap={2} align="center" color="fg" flex={1} minWidth={0}>
                  <Icon as={Key} boxSize={4} color="orange.fg" flexShrink={0} />
                  <Text fontSize="sm" lineHeight="snug">
                    <Text as="span" fontWeight="semibold" color="fg">
                      Generate an access token
                    </Text>{" "}
                    <Text as="span" color="fg.muted">
                      to fill the snippets below.
                    </Text>
                  </Text>
                </HStack>
                <Button
                  size="sm"
                  colorPalette="orange"
                  variant="solid"
                  onClick={handleGenerate}
                  loading={createMutation.isLoading}
                  flexShrink={0}
                >
                  Generate access token
                </Button>
              </HStack>
            </Box>
          )}
        </motion.div>
      </AnimatePresence>
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
