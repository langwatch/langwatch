import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Drawer } from "@langwatch/design-system/drawer";
import { CustomIcon, IconGlyph } from "@langwatch/design-system/icons";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { EmptyNextSteps, NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Button,
  Code,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
  Textarea,
} from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import { SettingsField } from "@langwatch/design-system/settings-field";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { useRef, useState, type ReactNode, type RefObject } from "react";

export type Method = "GET" | "POST" | "PUT" | "PATCH";
export type AuthType = "none" | "bearer" | "api_key";
export type TabValue = "body" | "auth" | "headers" | "test";

export interface Header {
  id: number;
  key: string;
  value: string;
}

/** Everything the form edits. Every tab reads and writes this one object. */
export interface AgentDraft {
  name: string;
  method: Method;
  url: string;
  body: string;
  outputPath: string;
  authType: AuthType;
  authSecret: string;
  headers: Header[];
}

/** What the endpoint answered. A refused connection rejects instead. */
export interface TestResult {
  status: number;
  durationMs: number;
  response: string;
}

/** Your API's save. It resolves when stored and rejects with a readable message. */
export type SaveAgent = (draft: AgentDraft) => Promise<void>;

/** Your API's connection test. It sends one request and resolves with the answer. */
export type TestAgent = (draft: AgentDraft) => Promise<TestResult>;

interface Problems {
  name?: string;
  url?: string;
}

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface LongDrawerStart {
  /** The drawer is shown unless this is false. */
  open?: boolean;
  tab?: TabValue;
  /** Edits made but not saved. */
  draft?: Partial<AgentDraft>;
  /** The lines shown under the fields, as if Save had just been pressed. */
  problems?: Problems;
  saving?: boolean;
  /** A refused save, with its reason. */
  failure?: string;
  testing?: boolean;
  testResult?: TestResult;
  /** A connection that was refused, with its reason. */
  testFailure?: string;
  /** The reader may look but not change. */
  readOnly?: boolean;
}

const DOCS = "https://docs.langwatch.ai/concepts";
const FORM_ID = "http-agent-form";

const METHODS: { value: Method }[] = [
  { value: "GET" },
  { value: "POST" },
  { value: "PUT" },
  { value: "PATCH" },
];

const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: "none", label: "No authentication" },
  { value: "bearer", label: "Bearer token" },
  { value: "api_key", label: "API key" },
];

export const SHORT_BODY = `{
  "thread_id": "{{thread_id}}",
  "messages": {{messages}}
}`;

export const LONG_BODY = `{
  "thread_id": "{{thread_id}}",
  "messages": {{messages}},
  "customer": {
    "id": "{{customer.id}}",
    "plan": "{{customer.plan}}",
    "locale": "{{customer.locale}}"
  },
  "context": {
    "channel": "support-chat",
    "order_id": "{{order.id}}",
    "order_status": "{{order.status}}",
    "order_total": "{{order.total}}",
    "currency": "{{order.currency}}"
  },
  "policy": {
    "refund_window_days": 30,
    "escalate_after_turns": 6,
    "allowed_actions": ["refund", "replace", "reship", "escalate"]
  },
  "options": {
    "stream": false,
    "temperature": 0.2,
    "max_tokens": 600,
    "language": "{{customer.locale}}"
  },
  "metadata": {
    "source": "langwatch-scenario",
    "agent": "support-http-agent",
    "run": "{{run_id}}"
  }
}`;

export const SAVED_AGENT: AgentDraft = {
  name: "Support HTTP agent",
  method: "POST",
  url: "https://api.example.com/support/chat",
  body: SHORT_BODY,
  outputPath: "$.reply",
  authType: "bearer",
  authSecret: "support-demo-token",
  headers: [
    { id: 1, key: "X-Team", value: "support" },
    { id: 2, key: "Accept", value: "application/json" },
  ],
};

export const LONG_HEADERS: Header[] = [
  { id: 1, key: "Accept", value: "application/json" },
  { id: 2, key: "Accept-Language", value: "en-GB" },
  { id: 3, key: "Content-Type", value: "application/json" },
  { id: 4, key: "X-Team", value: "support" },
  { id: 5, key: "X-Environment", value: "staging" },
  { id: 6, key: "X-Request-Source", value: "langwatch-scenario" },
  { id: 7, key: "X-Customer-Tier", value: "enterprise" },
  { id: 8, key: "X-Region", value: "eu-west-1" },
  { id: 9, key: "X-Trace-Sampling", value: "always" },
  { id: 10, key: "X-Idempotency-Key", value: "{{run_id}}" },
  { id: 11, key: "X-Feature-Flags", value: "refund-flow,order-lookup" },
  { id: 12, key: "X-Client-Version", value: "2026.10.1" },
  { id: 13, key: "Cache-Control", value: "no-store" },
  { id: 14, key: "User-Agent", value: "langwatch-http-agent/1" },
];

const SAMPLE_RESPONSE = JSON.stringify(
  { reply: "Refunds go back to the original card within five working days.", thread: "t-1042" },
  null,
  2,
);

/** A stand-in for your API: stores at once. Pass your own `save` to call a real one. */
const saveLocally: SaveAgent = () => Promise.resolve();

/** A stand-in for the connection test: answers at once. No request leaves the page. */
const testLocally: TestAgent = () =>
  Promise.resolve({ status: 200, durationMs: 412, response: SAMPLE_RESPONSE });

function validate(draft: AgentDraft): Problems {
  const problems: Problems = {};
  if (!draft.name.trim()) problems.name = "Enter a name for this agent.";
  if (!/^https?:\/\/\S+$/.test(draft.url.trim())) {
    problems.url = "Enter a full URL, starting with https://";
  }
  return problems;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "The service did not answer.";
}

/** Follows a plain `$.a.b` path through the response; anything fancier is your JSONPath library. */
function extractAt({ response, path }: { response: string; path: string }): string | undefined {
  try {
    let value: unknown = JSON.parse(response);
    for (const key of path
      .replace(/^\$\.?/, "")
      .split(".")
      .filter(Boolean)) {
      if (typeof value !== "object" || value === null || !(key in value)) return undefined;
      value = Reflect.get(value, key);
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function describeHeaders(count: number): string {
  if (count === 0) return "No custom headers";
  return count === 1 ? "1 custom header" : `${count} custom headers`;
}

/** What every tab reads and writes: the one draft, and whether the reader may change it. */
interface TabProps {
  draft: AgentDraft;
  change: (patch: Partial<AgentDraft>) => void;
  saving: boolean;
  readOnly: boolean;
}

function selectOption<Value extends string>({
  options,
  value,
}: {
  options: readonly { value: Value }[];
  value: string;
}): Value | undefined {
  return options.find((option) => option.value === value)?.value;
}

function EndpointFields({
  draft,
  change,
  saving,
  readOnly,
  problem,
  urlInput,
}: TabProps & { problem?: string; urlInput: RefObject<HTMLInputElement | null> }) {
  return (
    <Stack direction={{ base: "column", md: "row" }} gap={3} align="stretch">
      <Box flexShrink={0} width={{ base: "full", md: "8rem" }}>
        <SettingsField label="Method" disabled={saving} readOnly={readOnly}>
          <NativeSelect.Root width="full">
            <NativeSelect.Field
              value={draft.method}
              onChange={(event) => {
                const method = selectOption({ options: METHODS, value: event.target.value });
                if (method) change({ method });
              }}
            >
              {METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.value}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </SettingsField>
      </Box>
      <Box flex={1} minWidth={0}>
        <SettingsField label="URL" error={problem} disabled={saving} readOnly={readOnly}>
          <Input
            ref={urlInput}
            value={draft.url}
            onChange={(event) => change({ url: event.target.value })}
            placeholder="https://api.example.com/agent/chat"
          />
        </SettingsField>
      </Box>
    </Stack>
  );
}

function BodyTab({ draft, change, saving, readOnly }: TabProps) {
  return (
    <Stack gap={5} paddingTop={4}>
      <SettingsField
        label="Request body"
        hint={
          <>
            JSON sent to the endpoint. <InlineCode>{"{{messages}}"}</InlineCode> and the other
            variables are replaced on each run.
          </>
        }
        disabled={saving}
        readOnly={readOnly}
      >
        <Textarea
          value={draft.body}
          onChange={(event) => change({ body: event.target.value })}
          rows={14}
          textStyle="mono"
          spellCheck={false}
        />
      </SettingsField>
      <SettingsField
        label="Response path"
        hint={
          <>
            Where the reply is in the response, as a JSONPath such as{" "}
            <InlineCode>$.reply</InlineCode>.
          </>
        }
        disabled={saving}
        readOnly={readOnly}
      >
        <Input
          value={draft.outputPath}
          onChange={(event) => change({ outputPath: event.target.value })}
          textStyle="mono"
        />
      </SettingsField>
    </Stack>
  );
}

function AuthTab({ draft, change, saving, readOnly }: TabProps) {
  return (
    <Stack gap={5} paddingTop={4}>
      <SettingsField
        label="Authentication"
        hint="How the endpoint knows the call is yours."
        disabled={saving}
        readOnly={readOnly}
      >
        <NativeSelect.Root width="full">
          <NativeSelect.Field
            value={draft.authType}
            onChange={(event) => {
              const authType = selectOption({ options: AUTH_TYPES, value: event.target.value });
              if (authType) change({ authType });
            }}
          >
            {AUTH_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </SettingsField>
      {draft.authType !== "none" && (
        <SettingsField
          label={draft.authType === "bearer" ? "Bearer token" : "API key"}
          hint="Stored encrypted. Only the agent's admins can read it back."
          disabled={saving}
          readOnly={readOnly}
        >
          <Input
            type="password"
            autoComplete="off"
            value={readOnly ? "" : draft.authSecret}
            placeholder={readOnly ? "Stored on the agent" : "Paste the secret"}
            onChange={(event) => change({ authSecret: event.target.value })}
          />
        </SettingsField>
      )}
    </Stack>
  );
}

function HeaderRow({
  header,
  index,
  onChange,
  onRemove,
  saving,
  readOnly,
}: {
  header: Header;
  index: number;
  onChange: (patch: Partial<Header>) => void;
  onRemove: () => void;
  saving: boolean;
  readOnly: boolean;
}) {
  return (
    <Stack
      direction={{ base: "column", md: "row" }}
      gap={2}
      align={{ base: "stretch", md: "center" }}
    >
      <Input
        aria-label={`Header ${index + 1} name`}
        value={header.key}
        placeholder="Header name"
        disabled={saving}
        readOnly={readOnly}
        onChange={(event) => onChange({ key: event.target.value })}
      />
      <Input
        aria-label={`Header ${index + 1} value`}
        value={header.value}
        placeholder="Header value"
        disabled={saving}
        readOnly={readOnly}
        onChange={(event) => onChange({ value: event.target.value })}
      />
      {!readOnly && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          colorPalette="gray"
          disabled={saving}
          aria-label={`Remove header ${index + 1}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      )}
    </Stack>
  );
}

function HeadersTab({ draft, change, saving, readOnly }: TabProps) {
  const update = ({ id, patch }: { id: number; patch: Partial<Header> }) =>
    change({
      headers: draft.headers.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  return (
    <Stack asChild gap={3} paddingTop={4} minWidth={0}>
      <fieldset aria-label="Custom headers">
        {draft.headers.length === 0 && (
          <NoDataInfoBlock
            size="line"
            title="No custom headers yet."
            next={[{ kind: "docs", label: "What headers an agent can send", href: DOCS }]}
          />
        )}
        {draft.headers.map((header, index) => (
          <HeaderRow
            key={header.id}
            header={header}
            index={index}
            saving={saving}
            readOnly={readOnly}
            onChange={(patch) => update({ id: header.id, patch })}
            onRemove={() =>
              change({ headers: draft.headers.filter((item) => item.id !== header.id) })
            }
          />
        ))}
        {!readOnly && (
          <Box>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                const id = Math.max(0, ...draft.headers.map((item) => item.id)) + 1;
                change({ headers: [...draft.headers, { id, key: "", value: "" }] });
              }}
            >
              Add header
            </Button>
          </Box>
        )}
      </fieldset>
    </Stack>
  );
}

function DocsBanner({
  status,
  title,
  link,
  children,
}: {
  status: "info" | "error";
  title: string;
  link: string;
  children: ReactNode;
}) {
  return (
    <Banner
      status={status}
      title={title}
      action={<EmptyNextSteps next={[{ kind: "docs", label: link, href: DOCS }]} />}
    >
      {children}
    </Banner>
  );
}

function TestPanel({
  testing,
  result,
  failure,
  outputPath,
}: {
  testing: boolean;
  result?: TestResult;
  failure?: string;
  outputPath: string;
}) {
  if (testing) {
    return (
      <Text paddingTop={4} textStyle="sm" color="fg.muted" aria-busy="true">
        Sending one request…
      </Text>
    );
  }
  if (failure) {
    return (
      <Box paddingTop={4}>
        <DocsBanner
          status="error"
          title="Couldn't reach the endpoint"
          link="Connection troubleshooting"
        >
          {failure} Check the URL and the Auth tab, then test again.
        </DocsBanner>
      </Box>
    );
  }
  if (!result) {
    return (
      <Text paddingTop={4} textStyle="sm" color="fg.muted">
        Press Test connection to send one request with the body and headers you have set. Nothing is
        saved.
      </Text>
    );
  }
  return <TestOutcome result={result} outputPath={outputPath} />;
}

function TestOutcome({ result, outputPath }: { result: TestResult; outputPath: string }) {
  const ok = result.status < 400;
  const reply = extractAt({ response: result.response, path: outputPath });
  return (
    <Stack gap={3} paddingTop={4}>
      <Banner
        status={ok ? "success" : "error"}
        title={`Responded ${result.status} in ${result.durationMs} ms`}
      >
        {ok
          ? "The endpoint answered."
          : "The endpoint refused the request. Check the body and the Auth tab, then test again."}
      </Banner>
      <Card variant="nested" title="Response" titleLevel={3} padding="sm">
        <Code
          display="block"
          whiteSpace="pre-wrap"
          overflowWrap="anywhere"
          padding={3}
          width="full"
        >
          {result.response}
        </Code>
      </Card>
      {ok && (
        <Text textStyle="sm" color="fg.muted">
          The response path <InlineCode>{outputPath}</InlineCode>{" "}
          {reply === undefined
            ? "matched nothing. Change it in the Body tab."
            : `returned “${reply}”.`}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The Agents page and the Drawer that edits one HTTP agent. The application owns `save`,
 * `test` and the data; this owns the shapes, the draft and what each state looks like.
 */
export function LongDrawer({
  save = saveLocally,
  test = testLocally,
  start = {},
}: {
  save?: SaveAgent;
  test?: TestAgent;
  start?: LongDrawerStart;
}) {
  const [saved, setSaved] = useState<AgentDraft>(SAVED_AGENT);
  const [draft, setDraft] = useState<AgentDraft>({ ...SAVED_AGENT, ...start.draft });
  const [open, setOpen] = useState(start.open ?? true);
  const [tab, setTab] = useState<TabValue>(start.tab ?? "body");
  const [problems, setProblems] = useState<Problems>(start.problems ?? {});
  const [saving, setSaving] = useState(start.saving ?? false);
  const [failure, setFailure] = useState(start.failure);
  const [testing, setTesting] = useState(start.testing ?? false);
  const [testResult, setTestResult] = useState(start.testResult);
  const [testFailure, setTestFailure] = useState(start.testFailure);
  const readOnly = start.readOnly ?? false;
  const editButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  const change = (patch: Partial<AgentDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const tabProps: TabProps = { draft, change, saving, readOnly };

  const openEditor = () => {
    setDraft(saved);
    setProblems({});
    setFailure(undefined);
    setTestResult(undefined);
    setTestFailure(undefined);
    setTab("body");
    setOpen(true);
  };

  const submit = async () => {
    const found = validate(draft);
    setProblems(found);
    if (found.name || found.url) {
      (found.name ? nameInput : urlInput).current?.focus();
      return;
    }
    setFailure(undefined);
    setSaving(true);
    try {
      await save(draft);
      setSaved(draft);
      setOpen(false);
      toaster.create({
        id: "agent-saved",
        type: "success",
        title: "Agent saved",
        description: `${draft.name} will use the new endpoint on its next run.`,
      });
    } catch (error) {
      setFailure(reasonOf(error));
    }
    setSaving(false);
  };

  const runTest = async () => {
    setTab("test");
    setTesting(true);
    setTestResult(undefined);
    setTestFailure(undefined);
    try {
      setTestResult(await test(draft));
    } catch (error) {
      setTestFailure(reasonOf(error));
    }
    setTesting(false);
  };

  const invalidField = problems.name ? nameInput : urlInput;

  return (
    <ProductScope product="llm-ops">
      <PageLayout.Header description="The endpoints your agent tests and scenarios call.">
        <PageLayout.Heading>Agents</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="fill">
        <AgentCard agent={saved} editButton={editButton} onEdit={openEditor} />
      </PageLayout.Container>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Edit HTTP agent"
        subtitle="Calls your endpoint once for each message in a scenario or an evaluation."
        icon={<IconGlyph icon={<CustomIcon />} size="20px" />}
        size="lg"
        busy={saving}
        formId={FORM_ID}
        onSubmit={() => void submit()}
        initialFocusEl={() => (problems.name || problems.url ? invalidField : nameInput).current}
        onExitComplete={() => editButton.current?.focus()}
        toolbar={<EndpointFields {...tabProps} problem={problems.url} urlInput={urlInput} />}
        footer={{
          cancel: { label: readOnly ? "Done" : "Cancel", onClick: () => setOpen(false) },
          utilityActions: [
            {
              label: "Test connection",
              loading: testing,
              disabledReason: draft.url.trim() ? undefined : "Enter a URL to test it.",
              onClick: () => void runTest(),
            },
          ],
          primaryAction: readOnly
            ? undefined
            : { label: "Save changes", type: "submit", loading: saving },
        }}
      >
        <Stack gap={5}>
          {readOnly && (
            <DocsBanner
              status="info"
              title="Only project admins can change this agent"
              link="About roles and access"
            >
              You can read everything here and run a test. Ask an admin to make a change.
            </DocsBanner>
          )}
          {failure && (
            <DocsBanner status="error" title="Couldn't save the agent" link="Agent troubleshooting">
              {failure} Your changes are still here: save again to retry.
            </DocsBanner>
          )}
          <SettingsField
            label="Agent name"
            hint="How the agent is listed in scenarios and evaluations."
            error={problems.name}
            disabled={saving}
            readOnly={readOnly}
          >
            <Input
              ref={nameInput}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </SettingsField>

          <ContentTabs
            label="Request settings"
            density="compact"
            value={tab}
            onValueChange={({ value }) => setTab(value)}
            items={[
              { value: "body", label: "Body", content: <BodyTab {...tabProps} /> },
              { value: "auth", label: "Auth", content: <AuthTab {...tabProps} /> },
              {
                value: "headers",
                label: "Headers",
                count: draft.headers.length,
                content: <HeadersTab {...tabProps} />,
              },
              {
                value: "test",
                label: "Test",
                content: (
                  <TestPanel
                    testing={testing}
                    result={testResult}
                    failure={testFailure}
                    outputPath={draft.outputPath}
                  />
                ),
              },
            ]}
          />
        </Stack>
      </Drawer>
      <Toaster />
    </ProductScope>
  );
}

function AgentCard({
  agent,
  editButton,
  onEdit,
}: {
  agent: AgentDraft;
  editButton: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
}) {
  return (
    <Card
      title={agent.name}
      description={
        <>
          <InlineCode>{agent.method}</InlineCode> <InlineCode>{agent.url}</InlineCode>
        </>
      }
      footer={
        <HStack gap={3}>
          <Button ref={editButton} type="button" size="sm" variant="outline" onClick={onEdit}>
            Edit agent
          </Button>
          <Text textStyle="sm" color="fg.muted">
            {describeHeaders(agent.headers.length)}
          </Text>
        </HStack>
      }
    >
      <Text textStyle="sm" color="fg.muted">
        Called once for each message in a scenario or an evaluation.
      </Text>
    </Card>
  );
}
