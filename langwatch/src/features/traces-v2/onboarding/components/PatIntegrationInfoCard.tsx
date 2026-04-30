import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { Key, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
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
  // Every line in this block is something the user has to copy into
  // their environment, so all of them get the highlight treatment.
  // `ENDPOINT` is only emitted (and only highlighted) when self-hosted —
  // on cloud the SDK falls back to the default URL, so surfacing the
  // line at all would just be noise.
  const lines: EnvLine[] = [
    { key: "LANGWATCH_API_KEY", value: token, highlight: true },
    { key: "X-Project-Id", value: projectId, highlight: true },
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
 * `LANGWATCH_API_KEY` / `X-Project-Id` / `LANGWATCH_ENDPOINT`
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

  // `G` triggers Generate when the button is on screen. Skipped when a
  // token is already minted (button disappears) or while another mutation
  // is in flight, and suppressed for typing targets so it doesn't fire
  // when the user is in an input elsewhere on the page.
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
        handleGenerate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // handleGenerate closes over fresh deps each render; rebinding on
    // token / loading transitions is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, createMutation.isLoading]);

  // Pre-generation preview uses a non-secret obvious placeholder so the
  // blurred text doesn't accidentally read as a real key.
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

  // Single advisory: "you just generated, save it now" — fades in
  // after the user mints a token. `null` reserves no space pre-gen so
  // the card doesn't reserve a row for an empty advisory.
  const advisoryKey = token ? "post-gen" : "none";

  return (
    <VStack align="stretch" gap={2}>
      <Box position="relative">
        <Box
          filter={token ? undefined : "blur(5px)"}
          opacity={token ? undefined : 0.55}
          pointerEvents={token ? undefined : "none"}
          userSelect={token ? undefined : "none"}
          aria-hidden={token ? undefined : "true"}
          transition="filter 0.2s ease, opacity 0.2s ease"
        >
          <CodePreview
            code={code}
            filename=".env"
            codeLanguage="bash"
            highlightLines={highlightLines}
            sensitiveValue={token ?? undefined}
            enableVisibilityToggle={!!token}
            isVisible={revealed}
            onToggleVisibility={() => setRevealed((v) => !v)}
          />
        </Box>
        {!token && (
          <Flex
            position="absolute"
            inset={0}
            align="center"
            justify="center"
            paddingX={3}
          >
            <Button
              colorPalette="orange"
              variant="surface"
              onClick={handleGenerate}
              loading={createMutation.isLoading}
              boxShadow="lg"
            >
              <Key size={14} />
              Generate access token
              <Kbd>G</Kbd>
            </Button>
          </Flex>
        )}
      </Box>
      <AnimatePresence mode="wait" initial={false}>
        {advisoryKey === "post-gen" && (
          <motion.div
            key="post-gen"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <HStack gap={1.5} align="flex-start" color="fg.muted">
              <Icon
                as={Sparkles}
                boxSize={3}
                color="orange.fg"
                flexShrink={0}
                marginTop={0.5}
              />
              <Text fontSize="xs" lineHeight="tall">
                <Text as="span" color="orange.fg" fontWeight="semibold">
                  Copy this token before you move on.
                </Text>{" "}
                If you lose it? You can Mint another from Settings!
              </Text>
            </HStack>
          </motion.div>
        )}
      </AnimatePresence>
    </VStack>
  );
}
