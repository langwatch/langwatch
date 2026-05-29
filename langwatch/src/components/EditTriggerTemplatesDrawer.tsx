import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  NativeSelect,
  Separator,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw, Send } from "react-feather";
import dynamic from "~/utils/compat/next-dynamic";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";
import { api } from "~/utils/api";
import {
  clearLiquidMarkers,
  LIQUID_LANGUAGE_ID,
  type MonacoTextModel,
  registerLiquidLanguage,
  validateLiquidModel,
} from "./automations/liquidMonaco";
import { Drawer } from "./ui/drawer";
import { Link } from "./ui/link";
import { toaster } from "./ui/toaster";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

const PREVIEW_DEBOUNCE_MS = 400;

type SlackTemplateType = "string" | "block_kit";

interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

interface DraftState {
  emailSubject: FieldDraft;
  emailBody: FieldDraft;
  slack: FieldDraft;
  slackTemplateType: SlackTemplateType;
}

export function EditTriggerTemplatesDrawer({
  automationId,
}: {
  automationId?: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useContext();

  const projectId = project?.id ?? "";

  const templates = api.automation.getTemplates.useQuery(
    { triggerId: automationId ?? "", projectId },
    { enabled: !!automationId && !!projectId },
  );

  const channel: "email" | "slack" | null = templates.data
    ? templates.data.action === "SEND_SLACK_MESSAGE"
      ? "slack"
      : templates.data.action === "SEND_EMAIL"
        ? "email"
        : null
    : null;

  const variables = templates.data?.variables ?? [];
  const example = templates.data?.example;

  const [draft, setDraft] = useState<DraftState | null>(null);
  const hydratedForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!templates.data) return;
    const key = `${projectId}:${automationId}`;
    if (hydratedForRef.current === key) return;

    const { current, defaults } = templates.data;
    setDraft({
      emailSubject: {
        value: current.emailSubjectTemplate ?? defaults.emailSubject,
        usingDefault: current.emailSubjectTemplate == null,
      },
      emailBody: {
        value: current.emailBodyTemplate ?? defaults.emailBody,
        usingDefault: current.emailBodyTemplate == null,
      },
      slack: {
        value: current.slackTemplate ?? defaults.slack,
        usingDefault: current.slackTemplate == null,
      },
      slackTemplateType:
        current.slackTemplateType === "block_kit" ? "block_kit" : "string",
    });
    hydratedForRef.current = key;
  }, [templates.data, projectId, automationId]);

  const patchFromDraft = useCallback(
    (state: DraftState) => {
      if (channel === "email") {
        return {
          emailSubjectTemplate: state.emailSubject.usingDefault
            ? null
            : state.emailSubject.value,
          emailBodyTemplate: state.emailBody.usingDefault
            ? null
            : state.emailBody.value,
        };
      }
      return {
        slackTemplate: state.slack.usingDefault ? null : state.slack.value,
        slackTemplateType: state.slack.usingDefault
          ? null
          : state.slackTemplateType,
      };
    },
    [channel],
  );

  const preview = api.automation.previewTemplate.useMutation();
  const previewMutate = preview.mutate;
  const save = api.automation.saveTemplates.useMutation();
  const testFire = api.automation.testFireTemplate.useMutation();

  // Live preview: re-render (debounced) whenever the draft or channel changes.
  useEffect(() => {
    if (!draft || !channel || !automationId) return;
    const timer = setTimeout(() => {
      previewMutate({
        triggerId: automationId,
        projectId,
        channel,
        draft: patchFromDraft(draft),
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, channel, automationId, projectId, patchFromDraft, previewMutate]);

  const onSave = () => {
    if (!draft || !automationId) return;
    save.mutate(
      { triggerId: automationId, projectId, patch: patchFromDraft(draft) },
      {
        onSuccess: () => {
          toaster.create({
            title: "Templates saved",
            type: "success",
            description: "Notification templates updated.",
            meta: { closable: true },
          });
          void queryClient.automation.getTriggers.invalidate();
          void queryClient.automation.getTemplates.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Could not save templates",
            type: "error",
            description: error.message,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const onTestFire = () => {
    if (!automationId) return;
    testFire.mutate(
      { triggerId: automationId, projectId },
      {
        onSuccess: (result) => {
          toaster.create({
            title: "Test fire sent",
            type: "success",
            description:
              result.channel === "email"
                ? `Sent a test email to ${result.recipientCount} recipient(s).`
                : "Posted a test message to the Slack webhook.",
            meta: { closable: true },
          });
        },
        onError: (error) => {
          toaster.create({
            title: "Test fire failed",
            type: "error",
            description: error.message,
            meta: { closable: true },
          });
        },
      },
    );
  };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={({ open }) => !open && closeDrawer()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <Heading size="md">Customize notification templates</Heading>
        </Drawer.Header>
        <Drawer.Body>
          {templates.isLoading || !draft || !channel ? (
            <HStack color="fg.muted" gap={3} padding={4}>
              {templates.isLoading ? <Spinner size="sm" /> : null}
              <Text>
                {channel === null && templates.data
                  ? "This automation does not send notifications, so it has no templates."
                  : "Loading templates…"}
              </Text>
            </HStack>
          ) : (
            <HStack align="stretch" gap={6} height="full">
              <VStack align="stretch" gap={4} flex="1" minWidth="0">
                {channel === "email" ? (
                  <EmailEditors
                    draft={draft}
                    setDraft={setDraft}
                    variables={variables}
                  />
                ) : (
                  <SlackEditor
                    draft={draft}
                    setDraft={setDraft}
                    variables={variables}
                  />
                )}
                <VariableReference variables={variables} />
                {example ? <ExampleData example={example} /> : null}
              </VStack>

              <Separator orientation="vertical" />

              <VStack align="stretch" gap={3} flex="1" minWidth="0">
                <HStack>
                  <Text textStyle="sm" fontWeight="semibold">
                    Preview
                  </Text>
                  {preview.isLoading ? <Spinner size="xs" /> : null}
                  <Spacer />
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      previewMutate({
                        triggerId: automationId ?? "",
                        projectId,
                        channel,
                        draft: patchFromDraft(draft),
                      })
                    }
                  >
                    <RefreshCw size={13} /> Refresh
                  </Button>
                </HStack>
                <PreviewWarnings data={preview.data} />
                {preview.data?.channel === "email" ? (
                  <EmailPreview
                    subject={preview.data.subject}
                    html={preview.data.html}
                  />
                ) : preview.data?.channel === "slack" ? (
                  <SlackPreview payload={preview.data.payload} />
                ) : (
                  <Text color="fg.muted" textStyle="sm">
                    Edit a template to see a live preview.
                  </Text>
                )}
              </VStack>
            </HStack>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Button
              variant="outline"
              onClick={onTestFire}
              loading={testFire.isLoading}
              disabled={!draft || !channel}
            >
              <Send size={14} /> Test fire
            </Button>
            <Spacer />
            <Button variant="ghost" onClick={closeDrawer}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={onSave}
              loading={save.isLoading}
              disabled={!draft || !channel}
            >
              Save templates
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function FieldHeader({
  label,
  usingDefault,
  onReset,
}: {
  label: string;
  usingDefault: boolean;
  onReset: () => void;
}) {
  return (
    <HStack>
      <Text textStyle="sm" fontWeight="semibold">
        {label}
      </Text>
      {usingDefault ? (
        <Badge size="sm" colorPalette="gray">
          Using default
        </Badge>
      ) : (
        <Button size="xs" variant="ghost" onClick={onReset}>
          Reset to default
        </Button>
      )}
    </HStack>
  );
}

function liquidEditorOptions() {
  return {
    minimap: { enabled: false },
    fontSize: 13,
    wordWrap: "on" as const,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    lineNumbers: "off" as const,
    tabSize: 2,
    padding: { top: 12 },
  };
}

function defineMonokai(monaco: Monaco) {
  monaco.editor.defineTheme(
    "monokai",
    monokaiTheme as Parameters<typeof monaco.editor.defineTheme>[1],
  );
}

function EditorBox({
  value,
  onChange,
  variables,
  height = "200px",
}: {
  value: string;
  onChange: (value: string) => void;
  variables: string[];
  height?: string;
}) {
  const monacoRef = useRef<Monaco | null>(null);
  const modelRef = useRef<MonacoTextModel | null>(null);
  const changeSubscription = useRef<{ dispose: () => void } | null>(null);

  useEffect(
    () => () => {
      changeSubscription.current?.dispose();
      if (monacoRef.current && modelRef.current) {
        clearLiquidMarkers(monacoRef.current, modelRef.current);
      }
    },
    [],
  );

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    const model = editor.getModel();
    modelRef.current = model;
    if (model) validateLiquidModel(monaco, model, variables);
    changeSubscription.current = editor.onDidChangeModelContent(() => {
      const current = editor.getModel();
      if (current) validateLiquidModel(monaco, current, variables);
    });
  };

  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
      height={height}
      background="#272822"
    >
      <MonacoEditor
        height="100%"
        language={LIQUID_LANGUAGE_ID}
        value={value}
        theme="monokai"
        beforeMount={(monaco: Monaco) => {
          defineMonokai(monaco);
          registerLiquidLanguage(monaco, variables);
        }}
        onMount={onMount}
        onChange={(next: string | undefined) => onChange(next ?? "")}
        options={liquidEditorOptions()}
      />
    </Box>
  );
}

function EmailEditors({
  draft,
  setDraft,
  variables,
}: {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState | null>>;
  variables: string[];
}) {
  return (
    <>
      <VStack align="stretch" gap={2}>
        <FieldHeader
          label="Subject"
          usingDefault={draft.emailSubject.usingDefault}
          onReset={() =>
            setDraft((prev) =>
              prev
                ? {
                    ...prev,
                    emailSubject: { ...prev.emailSubject, usingDefault: true },
                  }
                : prev,
            )
          }
        />
        <EditorBox
          variables={variables}
          height="56px"
          value={draft.emailSubject.value}
          onChange={(value) =>
            setDraft((prev) =>
              prev
                ? {
                    ...prev,
                    emailSubject: { value, usingDefault: false },
                  }
                : prev,
            )
          }
        />
      </VStack>
      <VStack align="stretch" gap={2}>
        <FieldHeader
          label="Body (Markdown + Liquid)"
          usingDefault={draft.emailBody.usingDefault}
          onReset={() =>
            setDraft((prev) =>
              prev
                ? {
                    ...prev,
                    emailBody: { ...prev.emailBody, usingDefault: true },
                  }
                : prev,
            )
          }
        />
        <EditorBox
          variables={variables}
          height="280px"
          value={draft.emailBody.value}
          onChange={(value) =>
            setDraft((prev) =>
              prev
                ? { ...prev, emailBody: { value, usingDefault: false } }
                : prev,
            )
          }
        />
      </VStack>
    </>
  );
}

function SlackEditor({
  draft,
  setDraft,
  variables,
}: {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState | null>>;
  variables: string[];
}) {
  return (
    <>
      <VStack align="stretch" gap={2}>
        <Text textStyle="sm" fontWeight="semibold">
          Message type
        </Text>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={draft.slackTemplateType}
            onChange={(e) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      slackTemplateType: e.target.value as SlackTemplateType,
                    }
                  : prev,
              )
            }
          >
            <option value="string">Plain text</option>
            <option value="block_kit">Block Kit (JSON)</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </VStack>
      <VStack align="stretch" gap={2}>
        <FieldHeader
          label={
            draft.slackTemplateType === "block_kit"
              ? "Block Kit template (JSON + Liquid)"
              : "Message template (Liquid)"
          }
          usingDefault={draft.slack.usingDefault}
          onReset={() =>
            setDraft((prev) =>
              prev
                ? { ...prev, slack: { ...prev.slack, usingDefault: true } }
                : prev,
            )
          }
        />
        <EditorBox
          variables={variables}
          height="320px"
          value={draft.slack.value}
          onChange={(value) =>
            setDraft((prev) =>
              prev ? { ...prev, slack: { value, usingDefault: false } } : prev,
            )
          }
        />
      </VStack>
    </>
  );
}

function VariableReference({ variables }: { variables: string[] }) {
  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding={3}
      bg="bg.subtle"
    >
      <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={2}>
        Available variables — iterate matches with{" "}
        <Text as="span" fontFamily="mono">
          {"{% for m in matches %}"}
        </Text>
      </Text>
      <HStack wrap="wrap" gap={1}>
        {variables.map((variable) => (
          <Badge key={variable} size="sm" fontFamily="mono" colorPalette="gray">
            {variable}
          </Badge>
        ))}
      </HStack>
    </Box>
  );
}

function ExampleData({ example }: { example: unknown }) {
  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding={3}
      bg="bg.subtle"
    >
      <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={2}>
        Example data the preview renders against
      </Text>
      <Box
        as="pre"
        textStyle="xs"
        fontFamily="mono"
        whiteSpace="pre-wrap"
        color="fg.muted"
        maxHeight="200px"
        overflowY="auto"
      >
        {JSON.stringify(example, null, 2)}
      </Box>
    </Box>
  );
}

function PreviewWarnings({
  data,
}: {
  data:
    | {
        usedDefault: boolean;
        missingVariables: string[];
        errors: string[];
      }
    | undefined;
}) {
  if (!data) return null;
  const notes: string[] = [];
  if (data.errors.length > 0) {
    notes.push(`Fell back to the default template: ${data.errors.join("; ")}`);
  } else if (data.usedDefault) {
    notes.push("Rendered with the framework default template.");
  }
  if (data.missingVariables.length > 0) {
    notes.push(
      `Missing variables rendered empty: ${data.missingVariables.join(", ")}`,
    );
  }
  if (notes.length === 0) return null;

  return (
    <VStack align="stretch" gap={1}>
      {notes.map((note, i) => (
        <HStack
          key={i}
          gap={2}
          color="fg.warning"
          textStyle="xs"
          align="flex-start"
        >
          <Box pt="2px">
            <AlertTriangle size={13} />
          </Box>
          <Text>{note}</Text>
        </HStack>
      ))}
    </VStack>
  );
}

function EmailPreview({ subject, html }: { subject: string; html: string }) {
  return (
    <VStack align="stretch" gap={2} height="full">
      <Box>
        <Text textStyle="xs" color="fg.muted">
          Subject
        </Text>
        <Text fontWeight="medium">{subject}</Text>
      </Box>
      <Box
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
        flex="1"
        minHeight="320px"
        bg="white"
      >
        <iframe
          srcDoc={html}
          sandbox=""
          title="Email preview"
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </Box>
    </VStack>
  );
}

type SlackBlock = Record<string, unknown>;

function SlackPreview({
  payload,
}: {
  payload: { text: string } | { blocks: SlackBlock[] };
}) {
  const builderUrl = useMemo(() => {
    if (!("blocks" in payload)) return null;
    const json = JSON.stringify({ blocks: payload.blocks });
    return `https://app.slack.com/block-kit-builder#${encodeURIComponent(json)}`;
  }, [payload]);

  return (
    <VStack align="stretch" gap={2}>
      <Box
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        padding={3}
        bg="bg.panel"
      >
        {"text" in payload ? (
          <Text whiteSpace="pre-wrap">{renderSlackMrkdwn(payload.text)}</Text>
        ) : (
          <BlockKitBlocks blocks={payload.blocks} />
        )}
      </Box>
      {builderUrl ? (
        <Link href={builderUrl} isExternal color="orange.400" textStyle="sm">
          <HStack gap={1}>
            <Text>Open in Slack Block Kit Builder</Text>
            <ExternalLink size={13} />
          </HStack>
        </Link>
      ) : null}
    </VStack>
  );
}

function BlockKitBlocks({ blocks }: { blocks: SlackBlock[] }) {
  return (
    <VStack align="stretch" gap={2}>
      {blocks.map((block, i) => (
        <BlockKitBlock key={i} block={block} />
      ))}
    </VStack>
  );
}

function blockText(block: SlackBlock): string {
  const text = block.text;
  if (typeof text === "string") return text;
  if (text && typeof text === "object" && "text" in text) {
    const inner = (text as { text?: unknown }).text;
    return typeof inner === "string" ? inner : "";
  }
  return "";
}

function BlockKitBlock({ block }: { block: SlackBlock }) {
  switch (block.type) {
    case "header":
      return (
        <Text fontWeight="bold" textStyle="md">
          {blockText(block)}
        </Text>
      );
    case "section":
      return (
        <Text whiteSpace="pre-wrap">{renderSlackMrkdwn(blockText(block))}</Text>
      );
    case "context": {
      const elements = Array.isArray(block.elements) ? block.elements : [];
      const text = elements
        .map((el) =>
          el && typeof el === "object" && "text" in el
            ? String((el as { text?: unknown }).text ?? "")
            : "",
        )
        .join("  ");
      return (
        <Text textStyle="xs" color="fg.muted" whiteSpace="pre-wrap">
          {renderSlackMrkdwn(text)}
        </Text>
      );
    }
    case "divider":
      return <Separator />;
    case "image": {
      const url = typeof block.image_url === "string" ? block.image_url : "";
      const alt = typeof block.alt_text === "string" ? block.alt_text : "";
      return url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} style={{ maxWidth: "100%", borderRadius: 6 }} />
      ) : null;
    }
    default:
      return null;
  }
}

/**
 * Minimal Slack mrkdwn → React: links `<url|label>` / `<url>` and `*bold*`.
 * This is a preview approximation, not a full Slack renderer.
 */
function renderSlackMrkdwn(text: string): React.ReactNode[] {
  const linkPattern = /<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={key++}>{renderBold(text.slice(lastIndex, match.index))}</Fragment>,
      );
    }
    const url = match[1]!;
    const label = match[2] ?? url;
    nodes.push(
      <Link key={key++} href={url} isExternal color="orange.400">
        {label}
      </Link>,
    );
    lastIndex = linkPattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{renderBold(text.slice(lastIndex))}</Fragment>);
  }
  return nodes;
}

function renderBold(text: string): React.ReactNode[] {
  return text.split(/(\*[^*]+\*)/g).map((segment, i) =>
    segment.startsWith("*") && segment.endsWith("*") && segment.length > 2 ? (
      <Text as="span" key={i} fontWeight="bold">
        {segment.slice(1, -1)}
      </Text>
    ) : (
      <Fragment key={i}>{segment}</Fragment>
    ),
  );
}
