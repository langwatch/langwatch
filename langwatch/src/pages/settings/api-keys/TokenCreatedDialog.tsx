/**
 * TokenCreatedDialog — the one moment a secret key is readable.
 *
 * The key is shown exactly once, so the dialog is built around it: a credential
 * card leads, carrying the key in mono, the copy affordance that is the whole
 * point of the screen, and the "you won't see this again" warning woven into
 * its base — not floated below as a separate slab.
 *
 * Under it, a single row of concrete destinations replaces what used to be two
 * stacked tab groups ("Use in code" / "Use with code assistants"). A developer
 * does not think in those buckets; they think ".env", "the API", "my
 * assistant". Each destination shows exactly its snippet.
 *
 * The project selector sits with the destinations because it rewrites every
 * snippet, not one tab group.
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
import { Check, Clipboard, Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";
import {
  LW_RAINBOW_GRADIENT,
  RAINBOW_SURFACE_CSS,
} from "../../../components/brand/rainbow";
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

type Destination = "env" | "http" | "claude-code" | "codex" | "mcp";

const DESTINATIONS: { id: Destination; label: string }[] = [
  { id: "env", label: ".env" },
  { id: "http", label: "HTTP" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "mcp", label: "MCP config" },
];

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
 * The hero: the key on its own, before anything that consumes it.
 *
 * Masked by default — this dialog is often open on a shared screen — with the
 * rainbow riding the top edge, the same gradient at the same tempo as the
 * install commands, so the one un-repeatable thing in the dialog is also the
 * one that moves. Copy is the primary action of the whole screen and looks it.
 */
function CredentialCard({ token }: { token: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyToClipboard({
      text: token,
      successMessage: "Secret key copied to clipboard",
    });
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <Box
      borderRadius="xl"
      overflow="hidden"
      border="1px solid"
      borderColor="border.subtle"
      bg="bg.panel/60"
      boxShadow="xs"
    >
      <Box height="3px" css={RAINBOW_SURFACE_CSS} aria-hidden="true" />
      <VStack align="stretch" gap={0} paddingX={4} paddingTop={3.5}>
        <Text
          fontSize="2xs"
          fontWeight="700"
          letterSpacing="0.08em"
          textTransform="uppercase"
          color="fg.muted"
        >
          Secret key
        </Text>
        <HStack gap={2} align="center" paddingBottom={3.5}>
          <Text
            flex={1}
            minWidth={0}
            truncate
            fontFamily="'Geist Mono', 'IBM Plex Mono', Menlo, monospace"
            fontSize="15px"
            letterSpacing="-0.01em"
            color="fg"
            userSelect="all"
          >
            {revealed ? token : maskApiKey(token)}
          </Text>
          <Tooltip
            content={revealed ? "Hide secret key" : "Show secret key"}
            openDelay={0}
            showArrow
          >
            <IconButton
              size="sm"
              variant="ghost"
              borderRadius="lg"
              color="fg.muted"
              aria-label={revealed ? "Hide secret key" : "Show secret key"}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
            </IconButton>
          </Tooltip>
          <Button
            size="sm"
            borderRadius="lg"
            gap={1.5}
            colorPalette={copied ? "green" : "orange"}
            variant={copied ? "subtle" : "solid"}
            onClick={() => void copy()}
            minWidth="88px"
          >
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </HStack>
      </VStack>

      {/* The one-time warning belongs to the key, so it lives in the card's
          base rather than floating below as its own block. */}
      <Alert.Root
        status="warning"
        variant="subtle"
        borderRadius={0}
        paddingY={2}
        paddingX={4}
      >
        <Alert.Indicator />
        <Alert.Title fontSize="xs" fontWeight="medium">
          Copy this token now. You won&apos;t be able to see it again.
        </Alert.Title>
      </Alert.Root>
    </Box>
  );
}

/**
 * One row of destinations. The active pill carries the rainbow on its own
 * underline — the same brand motif as the key card, tying the "where is it
 * going" choice back to the thing being placed.
 */
function DestinationTabs({
  value,
  onChange,
}: {
  value: Destination;
  onChange: (next: Destination) => void;
}) {
  return (
    <HStack
      gap={0.5}
      overflowX="auto"
      paddingBottom={1}
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
    >
      {DESTINATIONS.map((destination) => {
        const active = destination.id === value;
        return (
          <Box key={destination.id} position="relative" flexShrink={0}>
            <Button
              size="sm"
              variant="ghost"
              borderRadius="md"
              paddingX={3}
              fontWeight={active ? "semibold" : "medium"}
              color={active ? "fg" : "fg.muted"}
              _hover={{ color: "fg", bg: "bg.muted/60" }}
              onClick={() => onChange(destination.id)}
            >
              {destination.label}
            </Button>
            {active && (
              <Box
                position="absolute"
                left={2}
                right={2}
                bottom="-1px"
                height="2px"
                borderRadius="full"
                css={{ backgroundImage: LW_RAINBOW_GRADIENT }}
                aria-hidden="true"
              />
            )}
          </Box>
        );
      })}
    </HStack>
  );
}

/** A snippet with its own one-line caption, so the pane reads without a legend. */
function CaptionedSnippet({
  caption,
  children,
}: {
  caption: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <VStack align="stretch" gap={1.5}>
      <Text fontSize="xs" color="fg.muted">
        {caption}
      </Text>
      {children}
    </VStack>
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
  const [destination, setDestination] = useState<Destination>("env");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projectId ?? "",
  );

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
        {
          key: "LANGWATCH_PROJECT_ID",
          value: activeProjectId ?? "<your-project-id>",
        },
        { key: "LANGWATCH_ENDPOINT", value: endpoint },
      ]),
    [newToken, activeProjectId, endpoint],
  );
  const envUnmasked = useMemo(
    () =>
      formatEnvLines([
        { key: "LANGWATCH_API_KEY", value: newToken ?? "" },
        {
          key: "LANGWATCH_PROJECT_ID",
          value: activeProjectId ?? "<your-project-id>",
        },
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
            {newToken && <CredentialCard token={newToken} />}

            {/* ── Where the key goes ── */}
            <VStack gap={3} align="stretch">
              <HStack justify="space-between" align="center" gap={3}>
                <Text fontWeight="600" fontSize="sm">
                  Add it to your setup
                </Text>
                {orgProjects.length > 1 && (
                  <HStack gap={2} align="center" flexShrink={0}>
                    <Text
                      fontSize="xs"
                      fontWeight="semibold"
                      color="fg.muted"
                    >
                      Project
                    </Text>
                    <Select.Root
                      collection={projectCollection}
                      value={activeProjectId ? [activeProjectId] : []}
                      onValueChange={(details) => {
                        setSelectedProjectId(details.value[0] ?? "");
                      }}
                      size="sm"
                      width="220px"
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
              </HStack>

              <DestinationTabs value={destination} onChange={setDestination} />

              {/* ── .env ── */}
              {destination === "env" && newToken && (
                <CaptionedSnippet caption="Load these into your app's environment.">
                  <ShikiCommandBox
                    command={envUnmasked}
                    maskedCommand={envMasked}
                    lang="ini"
                    copyLabel=".env"
                  />
                </CaptionedSnippet>
              )}

              {/* ── HTTP: Bearer + Basic ── */}
              {destination === "http" && (
                <VStack align="stretch" gap={4}>
                  <CaptionedSnippet
                    caption={
                      <>
                        Send the <code>Authorization</code> header with{" "}
                        <code>X-Project-Id</code>.
                      </>
                    }
                  >
                    <ShikiCommandBox
                      command={bearerUnmasked}
                      maskedCommand={bearerMasked}
                      lang="shellscript"
                      copyLabel="Bearer headers"
                    />
                  </CaptionedSnippet>
                  <CaptionedSnippet
                    caption={
                      <>
                        Or encode it as{" "}
                        <code>base64(projectId:token)</code> for Basic auth.
                      </>
                    }
                  >
                    <ShikiCommandBox
                      command={basicUnmasked}
                      maskedCommand={basicMasked}
                      lang="shellscript"
                      copyLabel="Basic Auth header"
                    />
                  </CaptionedSnippet>
                </VStack>
              )}

              {/* ── Claude Code ── */}
              {destination === "claude-code" && newToken && (
                <CaptionedSnippet caption="Run this in your terminal to register the MCP server.">
                  <ShikiCommandBox
                    command={claudeCommand}
                    maskedCommand={claudeMasked}
                    lang="bash"
                    showPrompt
                    copyLabel="Claude Code command"
                  />
                </CaptionedSnippet>
              )}

              {/* ── Codex ── */}
              {destination === "codex" && newToken && (
                <CaptionedSnippet caption="Run this in your terminal to register the MCP server.">
                  <ShikiCommandBox
                    command={codexCommand}
                    maskedCommand={codexMasked}
                    lang="bash"
                    showPrompt
                    copyLabel="Codex command"
                  />
                </CaptionedSnippet>
              )}

              {/* ── MCP config: JSON + per-editor paths ── */}
              {destination === "mcp" && newToken && (
                <VStack align="stretch" gap={2.5}>
                  <CaptionedSnippet caption="Paste this into your editor's MCP config file.">
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
                  </CaptionedSnippet>

                  {/* Each editor keeps this config somewhere different, so
                      these copy the path rather than spelling five of them out
                      inline. The row scrolls rather than wrapping ragged. */}
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
