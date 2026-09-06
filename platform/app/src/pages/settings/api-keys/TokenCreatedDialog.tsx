/**
 * TokenCreatedDialog — shown immediately after an API key is minted.
 *
 * Renders four sections:
 *  1. "Use in Code" tabs (.env / Bearer / Basic Auth) — CodePreview
 *  2. Amber "Copy this token now" warning
 *  3. "Use with Code Assistants" tabs (Claude Code / Codex) — CodePreview
 *  4. "Or paste into your config file" — existing JsonHighlight (no change)
 *
 * Snippets render through the shared CodePreview — the same surface the
 * traces empty state and onboarding screens use — so the dialog reads like
 * the rest of the product. CodePreview itself defers the Shiki engine via
 * `await import("shiki")` inside its adapter; the one static shiki path into
 * this page is the pre-existing JsonHighlight → shikiAdapter import below.
 * `copyText` feeds the clipboard the real value regardless of reveal state.
 *
 * @see specs/api-keys/token-created-snippets.feature
 */

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
import { CodePreview } from "../../../features/onboarding/components/sections/observability/CodePreview";
import { maskApiKey } from "../../../features/onboarding/components/sections/shared/api-key-utils";
import {
  buildMcpJson,
  CLOUD_ENDPOINT,
  findLangwatchEnvLines,
} from "../../../features/onboarding/components/sections/shared/build-mcp-config";
import { copyToClipboard } from "../../../features/onboarding/components/sections/shared/copy-to-clipboard";
import { InlineCopyButton } from "../../../features/onboarding/components/sections/shared/InlineCopyButton";
import { JsonHighlight } from "../../../features/onboarding/components/sections/shared/JsonHighlight";
import { TabButton } from "../../../features/onboarding/components/sections/shared/TabButton";
import { formatEnvLines } from "./utils";

type CodeTab = "env" | "bearer" | "basic";

/** What a snippet needs to name this project and this freshly minted token. */
interface CommandContext {
  apiKey: string;
  projectId: string | undefined;
  endpoint: string;
  isSelfHosted: boolean;
}

export interface CodeAssistant {
  key: string;
  label: string;
  /**
   * Present only where the assistant ships a one-line installer. Cursor,
   * Copilot, Windsurf and Claude Desktop are configured by editing a file, so
   * inventing a `cursor mcp add` for symmetry would hand out a command that
   * does not exist.
   */
  buildCommand?: (context: CommandContext) => string;
  /** The file this assistant reads its MCP servers from. */
  configPath?: string;
}

/**
 * The coding assistants this dialog knows how to set up, and the ONE place
 * that decides so.
 *
 * This list previously lived twice and disagreed with itself: two hardcoded
 * tabs (Claude Code, Codex) alongside five config-path chips naming a
 * different set of editors, which is how a customer came to notice that the
 * assistants they used were missing. Both surfaces below now read from here.
 *
 * Commands are the ones the docs publish — `claude mcp add` / `codex mcp add`
 * (docs/integration/mcp.mdx). An assistant with no published installer gets a
 * config path instead; inventing a command for symmetry hands the user a line
 * that fails at the one moment they can still read their token.
 */
export const CODE_ASSISTANTS: CodeAssistant[] = [
  {
    key: "claude-code",
    label: "Claude Code",
    configPath: ".claude/settings.json",
    buildCommand: ({ apiKey, projectId, endpoint, isSelfHosted }) =>
      [
        "claude mcp add langwatch",
        projectId ? ` --env LANGWATCH_PROJECT_ID=${projectId}` : "",
        " -- npx -y @langwatch/mcp-server",
        ` --api-key ${apiKey}`,
        isSelfHosted ? ` --endpoint ${endpoint}` : "",
      ].join(""),
  },
  {
    key: "codex",
    label: "Codex",
    // Deliberately no configPath: Codex reads TOML, and the chip row sits
    // under a block rendering JSON. Needs a format marker before it can
    // appear there — see #6654.
    buildCommand: ({ apiKey, projectId, endpoint, isSelfHosted }) =>
      [
        `codex mcp add langwatch --env LANGWATCH_API_KEY=${apiKey}`,
        projectId ? ` --env LANGWATCH_PROJECT_ID=${projectId}` : "",
        isSelfHosted ? ` --env LANGWATCH_ENDPOINT=${endpoint}` : "",
        " -- npx -y @langwatch/mcp-server",
      ].join(""),
  },
  // Gemini is deliberately absent until its command is verified against a
  // real `gemini` CLI — its `mcp add` takes options BEFORE the server name
  // and does not use `--` to introduce the command, unlike Codex above.
  // Tracked in #6654.
  { key: "cursor", label: "Cursor", configPath: ".cursor/mcp.json" },
  { key: "copilot", label: "Copilot", configPath: ".vscode/mcp.json" },
  {
    key: "windsurf",
    label: "Windsurf",
    configPath: "~/.codeium/windsurf/mcp_config.json",
  },
  {
    key: "claude-desktop",
    label: "Claude Desktop",
    configPath:
      "~/Library/Application Support/Claude/claude_desktop_config.json",
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
  const [assistantKey, setAssistantKey] = useState<string>(
    CODE_ASSISTANTS[0]!.key,
  );
  const [codeTab, setCodeTab] = useState<CodeTab>("env");
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

  // Each assistant's builder decides where its own flags go, so the flag
  // fragments that used to be assembled here now live in CODE_ASSISTANTS.
  const isSelfHosted = endpoint && endpoint !== CLOUD_ENDPOINT;

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
  // CodePreview owns masking: it substring-replaces `sensitiveValue` in the
  // rendered code, so only the real form is built here.
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
  const bearerUnmasked = `Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${activeProjectId ?? "<your-project-id>"}`;

  // ── Basic Auth snippet ─────────────────────────────────────────────────
  // The SECRET here is the encoded blob, not the raw token: a token is not a
  // substring of its own base64, so masking on the token would silently fail
  // open and render the credential in full.
  const basicBlob =
    newToken && activeProjectId ? btoa(`${activeProjectId}:${newToken}`) : "";
  const basicUnmasked = basicBlob ? `Authorization: Basic ${basicBlob}` : "";

  // ── Per-assistant terminal command ─────────────────────────────────────
  // Only the tab buttons set this key, and they map over the list itself, so
  // the lookup cannot miss; the fallback only satisfies the compiler.
  const activeAssistant =
    CODE_ASSISTANTS.find((assistant) => assistant.key === assistantKey) ??
    CODE_ASSISTANTS[0]!;

  const assistantCommand = activeAssistant.buildCommand?.({
    projectId: activeProjectId,
    endpoint,
    isSelfHosted: !!isSelfHosted,
    apiKey: newToken ?? "",
  });

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
                <CodePreview
                  code={envUnmasked}
                  copyText={envUnmasked}
                  filename=".env"
                  codeLanguage="ini"
                  sensitiveValue={newToken}
                  enableVisibilityToggle
                />
              )}

              {/* Bearer — shellscript-highlighted */}
              {codeTab === "bearer" && newToken && (
                <VStack gap={1} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Use the <code>Authorization</code> header plus{" "}
                    <code>X-Project-Id</code>:
                  </Text>
                  <CodePreview
                    code={bearerUnmasked}
                    copyText={bearerUnmasked}
                    filename="HTTP headers"
                    codeLanguage="shellscript"
                    sensitiveValue={newToken}
                    enableVisibilityToggle
                  />
                </VStack>
              )}

              {/* Basic Auth — shellscript-highlighted. The sensitive value is
                  the base64 blob (see basicBlob above). The encoded header
                  needs a project id, so without one the tab explains itself
                  instead of going silently blank. */}
              {codeTab === "basic" && (
                <VStack gap={1} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Encode the project ID and token as{" "}
                    <code>base64(projectId:token)</code>:
                  </Text>
                  {basicUnmasked ? (
                    <CodePreview
                      code={basicUnmasked}
                      copyText={basicUnmasked}
                      filename="HTTP headers"
                      codeLanguage="shellscript"
                      sensitiveValue={basicBlob}
                      enableVisibilityToggle
                    />
                  ) : (
                    <Text fontSize="xs" color="fg.muted">
                      Select a project to fill in this header.
                    </Text>
                  )}
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
                flexWrap="wrap"
              >
                {CODE_ASSISTANTS.map((assistant) => (
                  <TabButton
                    key={assistant.key}
                    label={assistant.label}
                    active={assistantKey === assistant.key}
                    onClick={() => setAssistantKey(assistant.key)}
                  />
                ))}
              </HStack>

              {/* Terminal command — bash-highlighted. Only the assistants
                  that actually ship an installer get one. */}
              {assistantCommand && newToken && (
                <VStack align="stretch" gap={3}>
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                    Run in your terminal
                  </Text>
                  <CodePreview
                    code={assistantCommand}
                    copyText={assistantCommand}
                    filename="Terminal"
                    codeLanguage="bash"
                    sensitiveValue={newToken}
                    enableVisibilityToggle
                  />
                </VStack>
              )}

              {/* Config-file-only assistants: say so, rather than leaving the
                  tab looking broken next to one that offers a command. */}
              {!assistantCommand && newToken && (
                <Text fontSize="xs" color="fg.muted">
                  {activeAssistant.label} has no install command — paste the
                  config below into{" "}
                  <Text as="span" fontWeight="semibold" color="fg">
                    {activeAssistant.configPath}
                  </Text>
                  .
                </Text>
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
                    {CODE_ASSISTANTS.filter((a) => a.configPath).map((ep) => (
                      <HStack
                        key={ep.key}
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
                            text: ep.configPath!,
                            successMessage: `${ep.label} config path copied`,
                          });
                        }}
                      >
                        <button
                          type="button"
                          aria-label={`Copy ${ep.label} config path`}
                        >
                          <Text fontSize="2xs" fontWeight="medium" color="fg">
                            {ep.label}
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
