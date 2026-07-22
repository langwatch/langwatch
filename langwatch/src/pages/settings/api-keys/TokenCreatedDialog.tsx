/**
 * TokenCreatedDialog — shown immediately after a secret key is minted.
 *
 * The key leads. This is the only moment it is ever readable, so it gets its
 * own row at the top with reveal and copy, rather than being reachable only by
 * reading it back out of a `.env` line further down. Everything under it is
 * about where to *put* the key:
 *
 *  1. "Use in code" tabs (.env / Bearer / Basic Auth) — ShikiCommandBox
 *  2. Amber "Copy this token now" warning
 *  3. "Use with code assistants" tabs (Claude Code / Codex) — ShikiCommandBox
 *  4. "Or paste into your config file" — existing JsonHighlight (no change)
 *
 * The project selector sits above all of them because it rewrites every
 * snippet in the dialog, not just the tab group it used to live inside.
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
  Button,
  createListCollection,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Clipboard, Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";
import { RAINBOW_SURFACE_CSS } from "../../../components/brand/rainbow";
import { Dialog } from "../../../components/ui/dialog";
import { Tooltip } from "../../../components/ui/tooltip";
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

/**
 * One tab strip, used by both groups so they read as the same control rather
 * than two similar-but-not-identical pills stacked down the dialog.
 */
function TabStrip({ children }: { children: React.ReactNode }) {
  return (
    <HStack
      gap={1}
      padding={1}
      borderRadius="lg"
      border="1px solid"
      borderColor="border.subtle"
      bg="bg.muted/50"
      width="fit-content"
    >
      {children}
    </HStack>
  );
}

/**
 * The key, on its own, once.
 *
 * Masked until asked for — the dialog is frequently open on a shared screen —
 * and the rainbow rides its top edge, the same gradient at the same tempo as
 * the install commands below, so the one un-repeatable thing in the dialog is
 * also the one that moves.
 */
function SecretKeyRow({ token }: { token: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Box
      borderRadius="xl"
      overflow="hidden"
      border="1px solid"
      borderColor="border.subtle"
      bg="bg.panel/70"
      boxShadow="xs"
    >
      <Box height="2px" css={RAINBOW_SURFACE_CSS} aria-hidden="true" />
      <HStack gap={1} paddingX={3} paddingY={2}>
        <Text
          flex={1}
          minWidth={0}
          truncate
          fontFamily="'Geist Mono', 'IBM Plex Mono', Menlo, monospace"
          fontSize="13px"
          letterSpacing="-0.01em"
          color="fg"
        >
          {revealed ? token : maskApiKey(token)}
        </Text>
        <Tooltip
          content={revealed ? "Hide secret key" : "Show secret key"}
          openDelay={0}
          showArrow
        >
          <IconButton
            size="xs"
            variant="ghost"
            borderRadius="lg"
            aria-label={revealed ? "Hide secret key" : "Show secret key"}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
        </Tooltip>
        <InlineCopyButton text={token} label="Secret key" />
      </HStack>
    </Box>
  );
}

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
          <Dialog.Title>Secret key created</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={6} align="stretch">
            {/* ── The key itself, before anything that consumes it ── */}
            {newToken && <SecretKeyRow token={newToken} />}

            {/* The project rewrites every snippet below, so it is chosen once
                here rather than from inside the first tab group. */}
            {orgProjects.length > 1 && (
              <HStack gap={2.5} justify="flex-end" width="full">
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                  Project
                </Text>
                <Select.Root
                  collection={projectCollection}
                  value={activeProjectId ? [activeProjectId] : []}
                  onValueChange={(details) => {
                    setSelectedProjectId(details.value[0] ?? "");
                  }}
                  size="sm"
                  width="240px"
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
              </HStack>
            )}

            {/* ── Section 1: Use in code ── */}
            <VStack gap={3} align="stretch">
              <Text fontWeight="700" fontSize="sm">
                Use in code
              </Text>
              <TabStrip>
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
              </TabStrip>

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

            {/* ── Section 2: Use with code assistants ── */}
            <VStack gap={3} align="stretch">
              <Text fontWeight="700" fontSize="sm">
                Use with code assistants
              </Text>

              <TabStrip>
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
              </TabStrip>

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

                  {/* Each editor keeps this config somewhere different, so
                      these copy the path rather than naming it: five paths
                      spelled out inline would outweigh the block above. The
                      row scrolls instead of wrapping into ragged rows. */}
                  <VStack align="stretch" gap={1.5}>
                    <Text fontSize="xs" color="fg.muted">
                      Copy the config path for your editor
                    </Text>
                    <HStack
                      gap={1.5}
                      overflowX="auto"
                      paddingBottom={1}
                      css={{ scrollbarWidth: "thin" }}
                    >
                      {EDITOR_PATHS.map((ep) => (
                        <Tooltip
                          key={ep.editor}
                          content={ep.path}
                          openDelay={200}
                          showArrow
                        >
                          <Button
                            size="xs"
                            variant="outline"
                            borderRadius="full"
                            flexShrink={0}
                            gap={1.5}
                            fontWeight="medium"
                            color="fg"
                            aria-label={`Copy ${ep.editor} config path`}
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
                            <Clipboard size={11} />
                            {ep.editor}
                          </Button>
                        </Tooltip>
                      ))}
                    </HStack>
                  </VStack>
                </VStack>
              )}
            </VStack>
          </VStack>
        </Dialog.Body>
        {/* Dismissing this is the point of no return for the key, so it gets a
            deliberate control rather than only the corner ✕. */}
        <Dialog.Footer>
          <Button colorPalette="orange" onClick={onClose}>
            Done
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
