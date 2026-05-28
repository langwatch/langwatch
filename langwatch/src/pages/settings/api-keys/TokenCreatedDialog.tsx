/**
 * TokenCreatedDialog — shown immediately after a PAT is minted.
 *
 * Renders four sections:
 *  1. "Use in Code" tabs (.env / Bearer / Basic Auth) — ShikiCommandBox
 *  2. Amber "Copy this token now" warning
 *  3. "Use with Code Assistants" tabs (Claude Code / Codex) — ShikiCommandBox
 *  4. "Or paste into your config file" — existing JsonHighlight (no change)
 *
 * ShikiCommandBox is lazy-loaded via dynamic() (ssr:false) so the settings
 * page never statically imports the ~hundreds-of-KB Shiki bundle at page load.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */

import type React from "react";
import {
  Alert,
  Box,
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { Dialog } from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { maskApiKey } from "../../../features/onboarding/components/sections/shared/api-key-utils";
import {
  buildMcpJson,
  CLOUD_ENDPOINT,
  findLangwatchEnvLines,
} from "../../../features/onboarding/components/sections/shared/build-mcp-config";
import { InlineCopyButton } from "../../../features/onboarding/components/sections/shared/InlineCopyButton";
import { JsonHighlight } from "../../../features/onboarding/components/sections/shared/JsonHighlight";
import { TabButton } from "../../../features/onboarding/components/sections/shared/TabButton";
import { copyToClipboard } from "../../../features/onboarding/components/sections/shared/copy-to-clipboard";
import dynamic from "~/utils/compat/next-dynamic";
import type { ShikiCommandBoxProps } from "~/components/code/ShikiCommandBox";
import { formatEnvLines, maskSecret } from "./utils";

// Lazy-load ShikiCommandBox so /settings/api-keys/index.tsx never statically
// imports shikiAdapter. The loading fallback is null (dialog already has
// ambient padding; a shimmer would feel heavy here).
const ShikiCommandBox = dynamic(
  () =>
    import("~/components/code/ShikiCommandBox").then((m) => m.ShikiCommandBox),
  { ssr: false },
) as React.ComponentType<ShikiCommandBoxProps>;

type AssistantTab = "claude-code" | "codex";
type CodeTab = "env" | "bearer" | "basic";

const EDITOR_PATHS = [
  { editor: "Claude Code", path: ".claude/settings.json" },
  { editor: "Cursor", path: ".cursor/mcp.json" },
  { editor: "Copilot", path: ".vscode/mcp.json" },
  { editor: "Windsurf", path: "~/.codeium/windsurf/mcp_config.json" },
  {
    editor: "Claude Desktop",
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
  },
];

export function TokenCreatedDialog({
  newToken,
  projectId,
  endpoint,
  orgProjects,
  onClose,
}: {
  newToken: string | null;
  projectId?: string;
  endpoint: string;
  orgProjects: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("claude-code");
  const [codeTab, setCodeTab] = useState<CodeTab>("env");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId ?? "");

  const activeProjectId = selectedProjectId || projectId;
  const maskedKey = maskApiKey(newToken ?? "");

  const projectCollection = useMemo(
    () =>
      createListCollection({
        items: orgProjects.map((p) => ({ label: p.name, value: p.id })),
      }),
    [orgProjects],
  );

  const isSelfHosted = endpoint && endpoint !== CLOUD_ENDPOINT;
  const endpointFlag = isSelfHosted ? ` --endpoint ${endpoint}` : "";
  const projectIdEnvBefore = activeProjectId
    ? ` --env LANGWATCH_PROJECT_ID=${activeProjectId}`
    : "";
  const projectIdEnvAfter = activeProjectId
    ? ` --env LANGWATCH_PROJECT_ID=${activeProjectId}`
    : "";

  const mcpJson = useMemo(
    () =>
      buildMcpJson({
        apiKey: newToken ?? "",
        endpoint,
        projectId: activeProjectId,
      }),
    [newToken, endpoint, activeProjectId],
  );

  const displayConfigJson = useMemo(
    () =>
      buildMcpJson({
        apiKey: maskedKey,
        endpoint,
        projectId: activeProjectId,
      }),
    [maskedKey, endpoint, activeProjectId],
  );

  // ── .env snippet ──────────────────────────────────────────────────────
  const envMasked = useMemo(
    () =>
      formatEnvLines([
        { key: "LANGWATCH_API_KEY", value: newToken ?? "", mask: true },
        { key: "LANGWATCH_PROJECT_ID", value: activeProjectId ?? "<your-project-id>" },
        { key: "LANGWATCH_ENDPOINT", value: endpoint },
      ]),
    [newToken, activeProjectId, endpoint],
  );
  const envUnmasked = useMemo(
    () =>
      formatEnvLines([
        { key: "LANGWATCH_API_KEY", value: newToken ?? "" },
        { key: "LANGWATCH_PROJECT_ID", value: activeProjectId ?? "<your-project-id>" },
        { key: "LANGWATCH_ENDPOINT", value: endpoint },
      ]),
    [newToken, activeProjectId, endpoint],
  );

  // ── Bearer snippet ─────────────────────────────────────────────────────
  const bearerMasked = newToken
    ? `Authorization: Bearer ${maskSecret(newToken)}\nX-Project-Id: ${activeProjectId ?? "<your-project-id>"}`
    : "";
  const bearerUnmasked = `Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${activeProjectId ?? "<your-project-id>"}`;

  // ── Basic Auth snippet ─────────────────────────────────────────────────
  const basicUnmasked =
    newToken && activeProjectId
      ? `Authorization: Basic ${btoa(`${activeProjectId}:${newToken}`)}`
      : "";
  const basicMasked = `Authorization: Basic base64(${activeProjectId ?? "<your-project-id>"}:pat-lw-...)`;

  // ── Claude Code command ────────────────────────────────────────────────
  const claudeCommand = `claude mcp add langwatch${projectIdEnvBefore} -- npx -y @langwatch/mcp-server --api-key ${newToken ?? ""}${endpointFlag}`;
  const claudeMasked = `claude mcp add langwatch${projectIdEnvBefore} -- npx -y @langwatch/mcp-server --api-key ${maskedKey}${endpointFlag}`;

  // ── Codex command ──────────────────────────────────────────────────────
  const codexCommand = `codex mcp add langwatch --env LANGWATCH_API_KEY=${newToken ?? ""}${projectIdEnvAfter}${isSelfHosted ? ` --env LANGWATCH_ENDPOINT=${endpoint}` : ""} -- npx -y @langwatch/mcp-server`;
  const codexMasked = `codex mcp add langwatch --env LANGWATCH_API_KEY=${maskedKey}${projectIdEnvAfter}${isSelfHosted ? ` --env LANGWATCH_ENDPOINT=${endpoint}` : ""} -- npx -y @langwatch/mcp-server`;

  return (
    <Dialog.Root
      size="xl"
      open={!!newToken}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Token Created</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={6} align="stretch">
            {/* ── Section 1: Use in Code ── */}
            <VStack gap={3} align="stretch">
              <HStack gap={4} align="start">
                <VStack gap={2} align="start" flex={1}>
                  <Text fontWeight="700" fontSize="sm">
                    Use in Code
                  </Text>
                  <HStack
                    gap={1}
                    px={1.5}
                    py={1.5}
                    borderRadius="xl"
                    border="1px solid"
                    borderColor="border.subtle"
                    bg="bg.panel/70"
                    boxShadow="sm"
                    width="fit-content"
                  >
                    <TabButton
                      label=".env"
                      active={codeTab === "env"}
                      onClick={() => setCodeTab("env")}
                    />
                    <TabButton
                      label="Bearer"
                      active={codeTab === "bearer"}
                      onClick={() => setCodeTab("bearer")}
                    />
                    <TabButton
                      label="Basic Auth"
                      active={codeTab === "basic"}
                      onClick={() => setCodeTab("basic")}
                    />
                  </HStack>
                </VStack>
                {orgProjects.length > 1 && (
                  <VStack gap={2} align="start" width="200px" flexShrink={0}>
                    <Text fontWeight="700" fontSize="sm">
                      Project
                    </Text>
                    <Select.Root
                      collection={projectCollection}
                      value={activeProjectId ? [activeProjectId] : []}
                      onValueChange={(details) => {
                        setSelectedProjectId(details.value[0] ?? "");
                      }}
                      size="sm"
                      width="full"
                    >
                      <Select.Trigger background="bg" borderRadius="lg">
                        <Select.ValueText placeholder="Select project" />
                      </Select.Trigger>
                      <Select.Content>
                        {projectCollection.items.map((item) => (
                          <Select.Item key={item.value} item={item}>
                            {item.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </VStack>
                )}
              </HStack>

              {/* .env — ini-highlighted */}
              {codeTab === "env" && newToken && (
                <ShikiCommandBox
                  command={envUnmasked}
                  maskedCommand={envMasked}
                  lang="ini"
                  copyLabel=".env"
                />
              )}

              {/* Bearer — shellscript-highlighted */}
              {codeTab === "bearer" && (
                <VStack gap={1} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Use the <code>Authorization</code> header plus{" "}
                    <code>X-Project-Id</code>:
                  </Text>
                  <ShikiCommandBox
                    command={bearerUnmasked}
                    maskedCommand={bearerMasked}
                    lang="shellscript"
                    copyLabel="Bearer headers"
                  />
                </VStack>
              )}

              {/* Basic Auth — shellscript-highlighted */}
              {codeTab === "basic" && (
                <VStack gap={1} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Encode the project ID and token as{" "}
                    <code>base64(projectId:token)</code>:
                  </Text>
                  <ShikiCommandBox
                    command={basicUnmasked}
                    maskedCommand={basicMasked}
                    lang="shellscript"
                    copyLabel="Basic Auth header"
                  />
                </VStack>
              )}
            </VStack>

            {/* ── Amber warning ── */}
            <Alert.Root status="warning" variant="subtle" opacity={0.8}>
              <Alert.Indicator />
              <Alert.Title fontSize="xs">
                Copy this token now. You won&apos;t be able to see it again.
              </Alert.Title>
            </Alert.Root>

            {/* ── Section 2: Use with Code Assistants ── */}
            <VStack gap={3} align="stretch">
              <Text fontWeight="700" fontSize="sm">
                Use with Code Assistants
              </Text>

              <HStack
                gap={1}
                px={1.5}
                py={1.5}
                borderRadius="xl"
                border="1px solid"
                borderColor="border.subtle"
                bg="bg.panel/70"
                boxShadow="sm"
                width="fit-content"
              >
                <TabButton
                  label="Claude Code"
                  active={assistantTab === "claude-code"}
                  onClick={() => setAssistantTab("claude-code")}
                />
                <TabButton
                  label="Codex"
                  active={assistantTab === "codex"}
                  onClick={() => setAssistantTab("codex")}
                />
              </HStack>

              {/* Claude Code terminal command — bash-highlighted with >_ prompt */}
              {assistantTab === "claude-code" && newToken && (
                <VStack align="stretch" gap={3}>
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                    Run in your terminal
                  </Text>
                  <ShikiCommandBox
                    command={claudeCommand}
                    maskedCommand={claudeMasked}
                    lang="bash"
                    showPrompt
                    copyLabel="Claude Code command"
                  />
                </VStack>
              )}

              {/* Codex terminal command — bash-highlighted with >_ prompt */}
              {assistantTab === "codex" && newToken && (
                <VStack align="stretch" gap={3}>
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                    Run in your terminal
                  </Text>
                  <ShikiCommandBox
                    command={codexCommand}
                    maskedCommand={codexMasked}
                    lang="bash"
                    showPrompt
                    copyLabel="Codex command"
                  />
                </VStack>
              )}

              {/* JSON config — existing JsonHighlight wiring unchanged */}
              {newToken && (
                <VStack align="stretch" gap={2}>
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                    Or paste into your config file
                  </Text>
                  <Box
                    position="relative"
                    borderRadius="xl"
                    overflow="hidden"
                    border="1px solid"
                    borderColor="border.subtle"
                    bg="bg.panel/70"
                    boxShadow="xs"
                    transition="all 0.17s ease"
                    _hover={{
                      borderColor: "orange.emphasized",
                      boxShadow: "md",
                    }}
                  >
                    <JsonHighlight
                      code={displayConfigJson}
                      highlightLines={findLangwatchEnvLines(displayConfigJson)}
                    />
                    <Box position="absolute" top={2.5} right={2.5}>
                      <InlineCopyButton text={mcpJson} label="Config" />
                    </Box>
                  </Box>

                  <HStack gap={2} flexWrap="wrap" align="center">
                    <Text fontSize="xs" color="fg.muted" flexShrink={0}>
                      Config path:
                    </Text>
                    {EDITOR_PATHS.map((ep) => (
                      <HStack
                        key={ep.editor}
                        asChild
                        gap={1}
                        px={2}
                        py={0.5}
                        borderRadius="md"
                        bg="bg.panel/60"
                        border="1px solid"
                        borderColor="border.subtle"
                        cursor="pointer"
                        transition="all 0.15s ease"
                        _hover={{
                          borderColor: "orange.emphasized",
                          bg: "bg.panel",
                        }}
                        onClick={() => {
                          void copyToClipboard({
                            text: ep.path,
                            successMessage: `${ep.editor} config path copied`,
                          });
                        }}
                      >
                        <button
                          type="button"
                          aria-label={`Copy ${ep.editor} config path`}
                        >
                          <Text fontSize="2xs" fontWeight="medium" color="fg">
                            {ep.editor}
                          </Text>
                        </button>
                      </HStack>
                    ))}
                  </HStack>
                </VStack>
              )}
            </VStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
