/**
 * One-time reveal: token displays masked (real value copied), lives in screen
 * state, cleared on close. Credential rules unchanged from moved platform file.
 * Spec: specs/api-keys/token-created-snippets.feature
 */

import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { type SnippetCopy, SnippetPreview } from "@langwatch/design-system/code-preview";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Dialog } from "@langwatch/design-system/dialog";
import { InlineCode } from "@langwatch/design-system/inline-code";
import {
  Alert,
  Box,
  Button,
  createListCollection,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Check, Clipboard, Eye, EyeOff, Key } from "lucide-react";
import { type Ref, useMemo, useRef, useState } from "react";

import { useApiKeyHost } from "../../model/api-key-host.ts";
import {
  buildMcpJson,
  CLOUD_ENDPOINT,
  findLangwatchEnvLines,
  formatEnvLines,
  maskApiKey,
} from "../../model/api-key-snippets.ts";
import { JsonHighlight } from "../blocks/json-highlight.tsx";
import { InlineCopyButton } from "../elements/inline-copy-button.tsx";

type CodeTab = "env" | "bearer" | "basic";

/** Every Shiki language this dialog names, guarded against lazy-load regression. */
export const TOKEN_SNIPPET_LANGUAGES = ["ini", "shellscript", "bash", "json"] as const;

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
   * Copilot, Windsurf and Claude Desktop edit a file instead, so inventing
   * a `cursor mcp add` for symmetry would hand out a command that doesn't exist.
   */
  buildCommand?: (context: CommandContext) => string;
  /** The file this assistant reads its MCP servers from. */
  configPath?: string;
}

/**
 * Centralized coding assistants list (was duplicated and disagreed); both tabs
 * and config chips read from here. Commands published in docs; others use paths.
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
    configPath: "~/Library/Application Support/Claude/claude_desktop_config.json",
  },
];

interface Project {
  id: string;
  name: string;
}

/** How the reachable projects settle which one a snippet names. */
export type ProjectChoice =
  | { kind: "none"; projectId: undefined }
  | { kind: "sole"; projectId: string; project: Project }
  | { kind: "pick"; projectId: string | undefined };

/**
 * Only a project this key can reach may enter a snippet: the lone one is used outright, several
 * leave the choice to the reader, and a selected or current project outside the list is ignored.
 */
export function chooseProject({
  projects,
  selectedId,
  currentId,
}: {
  projects: readonly Project[];
  selectedId: string | undefined;
  currentId: string | undefined;
}): ProjectChoice {
  const [only, ...others] = projects;
  if (!only) return { kind: "none", projectId: undefined };
  if (others.length === 0) return { kind: "sole", projectId: only.id, project: only };
  const reachable = (id: string | undefined) => projects.find((project) => project.id === id)?.id;
  return { kind: "pick", projectId: reachable(selectedId) ?? reachable(currentId) };
}

const NO_PROJECT_NOTE =
  "No project is reachable with this key, so there is no project ID to fill in here. The API key above can still be copied.";

function SnippetNote({ children }: { children: string }) {
  return (
    <Text textStyle="caption" color="fg.muted">
      {children}
    </Text>
  );
}

/** The key's name, its masked value with a reveal, and a labelled copy of the real token. */
function KeyHandOff({
  keyName,
  token,
  copy,
  copyRef,
}: {
  keyName: string | undefined;
  token: string;
  copy: SnippetCopy;
  copyRef: Ref<HTMLButtonElement>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyKey = async () => {
    if (!(await copy({ text: token, what: "API key" }))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Card
      variant="nested"
      padding="sm"
      titleLevel={3}
      title={keyName?.trim() || "API key"}
      description="Your new secret key"
      icon={<Key size={16} />}
      data-testid="token-created-key"
    >
      <HStack gap={2} flexWrap="wrap" align="center">
        <Box flex="1 1 12rem" minWidth={0}>
          <InlineCode
            variant="neutral"
            data-testid="token-created-key-value"
            height="auto"
            whiteSpace="normal"
            wordBreak="break-all"
            overflow="visible"
            textOverflow="clip"
          >
            {revealed ? token : maskApiKey(token)}
          </InlineCode>
        </Box>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={revealed ? "Hide API key" : "Show API key"}
          aria-pressed={revealed}
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
        <Button
          ref={copyRef}
          size="sm"
          variant="outline"
          aria-label="Copy API key"
          data-testid="token-created-copy-key"
          colorPalette={copied ? "green" : "gray"}
          onClick={() => void copyKey()}
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
          {copied ? "Copied" : "Copy API key"}
        </Button>
      </HStack>
    </Card>
  );
}

function TokenCreatedBody({
  token,
  keyName,
  projectId,
  endpoint,
  orgProjects,
  copyKeyRef,
}: {
  token: string;
  keyName: string | undefined;
  projectId: string | undefined;
  endpoint: string;
  orgProjects: Project[];
  copyKeyRef: Ref<HTMLButtonElement>;
}) {
  const host = useApiKeyHost();
  const [copyFailed, setCopyFailed] = useState(false);
  const copySnippet: SnippetCopy = async ({ text, what }) => {
    const copied = await host.copyToClipboard({
      text,
      succeeded: { title: "Copied", description: `${what} copied to clipboard` },
    });
    setCopyFailed(!copied);
    return copied;
  };
  const [assistantKey, setAssistantKey] = useState<string>(CODE_ASSISTANTS[0]!.key);
  const [codeTab, setCodeTab] = useState<CodeTab>("env");
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(void 0);

  const choice = chooseProject({
    projects: orgProjects,
    selectedId: selectedProjectId,
    currentId: projectId,
  });
  const activeProjectId = choice.projectId;
  const maskedKey = maskApiKey(token);

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
    () => buildMcpJson({ apiKey: token, endpoint, projectId: activeProjectId }),
    [token, endpoint, activeProjectId],
  );

  const displayConfigJson = useMemo(
    () => buildMcpJson({ apiKey: maskedKey, endpoint, projectId: activeProjectId }),
    [maskedKey, endpoint, activeProjectId],
  );

  // SnippetPreview owns masking: it substring-replaces `sensitiveValue` in the
  // rendered code, so only the real form is built here.
  const envUnmasked = activeProjectId
    ? formatEnvLines([
        { key: "LANGWATCH_API_KEY", value: token },
        { key: "LANGWATCH_PROJECT_ID", value: activeProjectId },
        { key: "LANGWATCH_ENDPOINT", value: endpoint },
      ])
    : "";
  const bearerUnmasked = activeProjectId
    ? `Authorization: Bearer ${token}\nX-Project-Id: ${activeProjectId}`
    : "";
  // The SECRET here is the encoded blob, not the raw token: a token is not a
  // substring of its own base64, so masking on the token would silently fail
  // open and render the credential in full.
  const basicBlob = activeProjectId ? btoa(`${activeProjectId}:${token}`) : "";
  const basicUnmasked = basicBlob ? `Authorization: Basic ${basicBlob}` : "";

  const withoutProject = (noun: string) =>
    choice.kind === "none" ? NO_PROJECT_NOTE : `Select a project to fill in this ${noun}.`;

  const assistantItems = CODE_ASSISTANTS.map((assistant) => {
    const command = assistant.buildCommand?.({
      projectId: activeProjectId,
      endpoint,
      isSelfHosted: !!isSelfHosted,
      apiKey: token,
    });
    return {
      value: assistant.key,
      label: assistant.label,
      content: (
        <Box paddingTop={3}>
          {command ? (
            <VStack align="stretch" gap={3}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                Run in your terminal
              </Text>
              <SnippetPreview
                copy={copySnippet}
                code={command}
                copyText={command}
                filename="Terminal"
                codeLanguage="bash"
                sensitiveValue={token}
                enableVisibilityToggle
              />
            </VStack>
          ) : (
            <Text textStyle="caption" color="fg.muted">
              {assistant.label} has no install command: paste the config below into{" "}
              <InlineCode>{assistant.configPath ?? ""}</InlineCode>.
            </Text>
          )}
        </Box>
      ),
    };
  });

  return (
    <VStack gap={6} align="stretch">
      <VStack gap={3} align="stretch">
        <KeyHandOff keyName={keyName} token={token} copy={copySnippet} copyRef={copyKeyRef} />
        {copyFailed && (
          <Banner
            status="error"
            title="Couldn't copy to the clipboard."
            data-testid="token-created-copy-failed"
          >
            Reveal the value and copy it by hand, or try again.
          </Banner>
        )}
      </VStack>

      <VStack as="section" aria-label="Use in Code" gap={3} align="stretch">
        <HStack gap={4} align="start" justify="space-between" flexWrap="wrap">
          <Text textStyle="cardTitle">Use in Code</Text>
          {choice.kind === "sole" && (
            <HStack gap={2} data-testid="token-created-project">
              <Text textStyle="caption" color="fg.muted">
                Project
              </Text>
              <Text textStyle="caption" fontWeight="semibold">
                {choice.project.name}
              </Text>
            </HStack>
          )}
          {choice.kind === "pick" && (
            <VStack gap={2} align="start" width={{ base: "full", sm: "200px" }} flexShrink={0}>
              <Text textStyle="caption" color="fg.muted">
                Project
              </Text>
              <Select.Root
                collection={projectCollection}
                value={activeProjectId ? [activeProjectId] : []}
                onValueChange={(details) => {
                  setSelectedProjectId(details.value[0]);
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

        <ContentTabs<CodeTab>
          label="Use in Code format"
          value={codeTab}
          onValueChange={({ value }) => setCodeTab(value)}
          body="flush"
          mount="active"
          items={[
            {
              value: "env",
              label: ".env",
              testId: "token-created-tab-env",
              content: (
                <Box paddingTop={3}>
                  {envUnmasked ? (
                    <SnippetPreview
                      copy={copySnippet}
                      code={envUnmasked}
                      copyText={envUnmasked}
                      filename=".env"
                      codeLanguage="ini"
                      sensitiveValue={token}
                      enableVisibilityToggle
                    />
                  ) : (
                    <SnippetNote>{withoutProject("file")}</SnippetNote>
                  )}
                </Box>
              ),
            },
            {
              value: "bearer",
              label: "Bearer",
              testId: "token-created-tab-bearer",
              content: (
                <VStack gap={1} align="stretch" paddingTop={3}>
                  <Text textStyle="caption" color="fg.muted">
                    Use the <InlineCode>Authorization</InlineCode> header plus{" "}
                    <InlineCode>X-Project-Id</InlineCode>:
                  </Text>
                  {bearerUnmasked ? (
                    <SnippetPreview
                      copy={copySnippet}
                      code={bearerUnmasked}
                      copyText={bearerUnmasked}
                      filename="HTTP headers"
                      codeLanguage="shellscript"
                      sensitiveValue={token}
                      enableVisibilityToggle
                      testId="token-created-bearer"
                    />
                  ) : (
                    <SnippetNote>{withoutProject("header")}</SnippetNote>
                  )}
                </VStack>
              ),
            },
            {
              value: "basic",
              label: "Basic Auth",
              testId: "token-created-tab-basic",
              content: (
                <VStack gap={1} align="stretch" paddingTop={3}>
                  <Text textStyle="caption" color="fg.muted">
                    Encode the project ID and token as{" "}
                    <InlineCode>base64(projectId:token)</InlineCode>:
                  </Text>
                  {basicUnmasked ? (
                    <SnippetPreview
                      copy={copySnippet}
                      code={basicUnmasked}
                      copyText={basicUnmasked}
                      filename="HTTP headers"
                      codeLanguage="shellscript"
                      sensitiveValue={basicBlob}
                      enableVisibilityToggle
                    />
                  ) : (
                    <SnippetNote>{withoutProject("header")}</SnippetNote>
                  )}
                </VStack>
              ),
            },
          ]}
        />
      </VStack>

      <Alert.Root status="warning" size="sm">
        <Alert.Indicator />
        <Alert.Title>Copy this token now. You won&apos;t be able to see it again.</Alert.Title>
      </Alert.Root>

      <VStack as="section" aria-label="Use with Code Assistants" gap={3} align="stretch">
        <Text textStyle="cardTitle">Use with Code Assistants</Text>
        <ContentTabs
          label="Code assistant"
          value={assistantKey}
          onValueChange={({ value }) => setAssistantKey(value)}
          body="flush"
          mount="active"
          items={assistantItems}
        />

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
            <Text textStyle="caption" color="fg.muted" flexShrink={0}>
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
                  void host.copyToClipboard({
                    text: ep.configPath!,
                    succeeded: {
                      title: "Copied",
                      description: `${ep.label} config path copied`,
                    },
                  });
                }}
              >
                <button type="button" aria-label={`Copy ${ep.label} config path`}>
                  <Text fontSize="2xs" fontWeight="medium" color="fg">
                    {ep.label}
                  </Text>
                </button>
              </HStack>
            ))}
          </HStack>
        </VStack>
      </VStack>
    </VStack>
  );
}

export function TokenCreatedDialog({
  newToken,
  keyName,
  projectId,
  endpoint,
  orgProjects,
  onClose,
}: {
  newToken: string | null;
  keyName?: string;
  projectId?: string;
  endpoint: string;
  orgProjects: Project[];
  onClose: () => void;
}) {
  const copyKeyRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={!!newToken}
      onClose={onClose}
      title="Token created"
      size="xl"
      cancelLabel={null}
      closeOnInteractOutside={false}
      initialFocusEl={() => copyKeyRef.current}
      primaryAction={{ label: "Done", onClick: onClose, "data-testid": "token-created-done" }}
      data-testid="token-created-dialog"
    >
      {newToken && (
        <TokenCreatedBody
          key={newToken}
          token={newToken}
          keyName={keyName}
          projectId={projectId}
          endpoint={endpoint}
          orgProjects={orgProjects}
          copyKeyRef={copyKeyRef}
        />
      )}
    </Dialog>
  );
}
