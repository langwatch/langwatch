import {
  Alert,
  Box,
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Terminal } from "lucide-react";
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
import { CodeBlock } from "./CodeBlock";
import { formatEnvLines, maskSecret } from "./utils";

type AssistantTab = "claude-code" | "codex";
type CodeTab = "env" | "bearer" | "basic";

function accentCredentialSegments(command: string): React.ReactNode[] {
  const re =
    /(--api-key \S+|LANGWATCH_(?:API_KEY|PROJECT_ID|ENDPOINT)=\S+)/g;
  return command.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <Text as="span" key={i} color="orange.fg" fontWeight="semibold">
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

function QuickCommand({
  label,
  displayCommand,
  copyCommand,
}: {
  label: string;
  displayCommand: string;
  copyCommand: string;
}) {
  return (
    <HStack
      justify="space-between"
      align="center"
      px={4}
      py={3}
      borderRadius="xl"
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
      <HStack gap={2.5} align="center" minW={0}>
        <Box flexShrink={0} display="flex" alignItems="center">
          <Terminal size={13} color="var(--chakra-colors-fg-muted)" />
        </Box>
        <VStack align="start" gap={0} minW={0}>
          <Text fontSize="xs" fontWeight="semibold" color="fg">
            {label}
          </Text>
          <Text
            fontSize="xs"
            fontFamily="mono"
            color="fg.muted"
            wordBreak="break-all"
          >
            {accentCredentialSegments(displayCommand)}
          </Text>
        </VStack>
      </HStack>
      <InlineCopyButton text={copyCommand} label="Command" />
    </HStack>
  );
}

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
  const maskedEndpointFlag = isSelfHosted ? ` --endpoint ${endpoint}` : "";
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

  return (
    <Dialog.Root
      size="xl"
      open={!!newToken}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Token Created</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack gap={6} align="stretch">
            <Alert.Root status="warning">
              <Alert.Indicator />
              <Alert.Title>
                Copy this token now. You won&apos;t be able to see it again.
              </Alert.Title>
            </Alert.Root>

            {/* ── Section 1: Code Assistants ── */}
            <VStack gap={3} align="stretch">
              <HStack justify="space-between" align="baseline">
                <Text fontWeight="700" fontSize="sm">
                  Use with Code Assistants
                </Text>
                {orgProjects.length > 1 && (
                  <Text fontSize="sm" fontWeight="700">
                    Project
                  </Text>
                )}
              </HStack>

              <HStack gap={3} align="center" flexWrap="wrap" justify="space-between">
                <HStack gap={1} px={1.5} py={1.5} borderRadius="xl" border="1px solid" borderColor="border.subtle" bg="bg.panel/70" boxShadow="sm" width="fit-content">
                  <TabButton label="Claude Code" active={assistantTab === "claude-code"} onClick={() => setAssistantTab("claude-code")} />
                  <TabButton label="Codex" active={assistantTab === "codex"} onClick={() => setAssistantTab("codex")} />
                </HStack>
                {orgProjects.length > 1 && (
                  <Select.Root
                    collection={projectCollection}
                    value={activeProjectId ? [activeProjectId] : []}
                    onValueChange={(details) => {
                      setSelectedProjectId(details.value[0] ?? "");
                    }}
                    size="sm"
                    width="200px"
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
                )}
              </HStack>

              {/* Quick setup command */}
              {assistantTab === "claude-code" && newToken && (
                <VStack align="stretch" gap={3}>
                  <QuickCommand
                    label="Run in your terminal"
                    displayCommand={`claude mcp add langwatch${projectIdEnvBefore} -- npx -y @langwatch/mcp-server --api-key ${maskedKey}${maskedEndpointFlag}`}
                    copyCommand={`claude mcp add langwatch${projectIdEnvBefore} -- npx -y @langwatch/mcp-server --api-key ${newToken}${endpointFlag}`}
                  />
                </VStack>
              )}

              {assistantTab === "codex" && newToken && (
                <VStack align="stretch" gap={3}>
                  <QuickCommand
                    label="Run in your terminal"
                    displayCommand={`codex mcp add langwatch --env LANGWATCH_API_KEY=${maskedKey}${projectIdEnvAfter}${isSelfHosted ? ` --env LANGWATCH_ENDPOINT=${endpoint}` : ""} -- npx -y @langwatch/mcp-server`}
                    copyCommand={`codex mcp add langwatch --env LANGWATCH_API_KEY=${newToken}${projectIdEnvAfter}${isSelfHosted ? ` --env LANGWATCH_ENDPOINT=${endpoint}` : ""} -- npx -y @langwatch/mcp-server`}
                  />
                </VStack>
              )}

              {/* JSON config */}
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
                        _hover={{ borderColor: "orange.emphasized", bg: "bg.panel" }}
                        onClick={() => {
                          void copyToClipboard({
                            text: ep.path,
                            successMessage: `${ep.editor} config path copied`,
                          });
                        }}
                      >
                        <button type="button" aria-label={`Copy ${ep.editor} config path`}>
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

            {/* ── Section 2: Code Implementation ── */}
            <VStack gap={3} align="stretch">
              <Text fontWeight="700" fontSize="sm">
                Use in Code
              </Text>

              <HStack gap={1} px={1.5} py={1.5} borderRadius="xl" border="1px solid" borderColor="border.subtle" bg="bg.panel/70" boxShadow="sm" width="fit-content">
                <TabButton label=".env" active={codeTab === "env"} onClick={() => setCodeTab("env")} />
                <TabButton label="Bearer" active={codeTab === "bearer"} onClick={() => setCodeTab("bearer")} />
                <TabButton label="Basic Auth" active={codeTab === "basic"} onClick={() => setCodeTab("basic")} />
              </HStack>

              {codeTab === "env" && newToken && (
                <CodeBlock
                  label=".env"
                  defaultRevealed
                  display={formatEnvLines([
                    { key: "LANGWATCH_API_KEY", value: newToken, mask: true },
                    { key: "LANGWATCH_PROJECT_ID", value: activeProjectId ?? "<your-project-id>" },
                    { key: "LANGWATCH_ENDPOINT", value: endpoint },
                  ])}
                  revealedDisplay={formatEnvLines([
                    { key: "LANGWATCH_API_KEY", value: newToken },
                    { key: "LANGWATCH_PROJECT_ID", value: activeProjectId ?? "<your-project-id>" },
                    { key: "LANGWATCH_ENDPOINT", value: endpoint },
                  ])}
                  copyValue={formatEnvLines([
                    { key: "LANGWATCH_API_KEY", value: newToken },
                    { key: "LANGWATCH_PROJECT_ID", value: activeProjectId ?? "<your-project-id>" },
                    { key: "LANGWATCH_ENDPOINT", value: endpoint },
                  ])}
                  copyToastTitle=".env copied to clipboard"
                  ariaLabel="Copy .env contents"
                />
              )}

              {codeTab === "bearer" && (
                <VStack gap={1} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Use the <code>Authorization</code> header plus{" "}
                    <code>X-Project-Id</code>:
                  </Text>
                  <CodeBlock
                    label="http"
                    display={`Authorization: Bearer ${newToken ? maskSecret(newToken) : "pat-lw-..."}\nX-Project-Id: ${activeProjectId ?? "<your-project-id>"}`}
                    revealedDisplay={`Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${activeProjectId ?? "<your-project-id>"}`}
                    copyValue={`Authorization: Bearer ${newToken ?? ""}\nX-Project-Id: ${activeProjectId ?? "<your-project-id>"}`}
                    copyToastTitle="Bearer headers copied"
                    ariaLabel="Copy Bearer headers"
                  />
                </VStack>
              )}

              {codeTab === "basic" && (
                <VStack gap={1} align="stretch">
                  <Text fontSize="xs" color="fg.muted">
                    Encode the project ID and token as{" "}
                    <code>base64(projectId:token)</code>:
                  </Text>
                  <CodeBlock
                    label="http"
                    display={`Authorization: Basic base64(${activeProjectId ?? "<your-project-id>"}:pat-lw-...)`}
                    revealedDisplay={
                      newToken && activeProjectId
                        ? `Authorization: Basic ${btoa(`${activeProjectId}:${newToken}`)}`
                        : ""
                    }
                    copyValue={
                      newToken && activeProjectId
                        ? `Authorization: Basic ${btoa(`${activeProjectId}:${newToken}`)}`
                        : ""
                    }
                    copyToastTitle="Basic Auth header copied"
                    ariaLabel="Copy Basic Auth header"
                  />
                </VStack>
              )}
            </VStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
