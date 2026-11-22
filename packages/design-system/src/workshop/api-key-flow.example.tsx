import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { SnippetPreview, type SnippetCopy } from "@langwatch/design-system/code-preview";
import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Dialog } from "@langwatch/design-system/dialog";
import { Drawer } from "@langwatch/design-system/drawer";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListPage } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { EmptyNextSteps } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Text,
  Textarea,
} from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { SettingsField, SettingsFieldGroup } from "@langwatch/design-system/settings-field";
import { Toaster, toaster } from "@langwatch/design-system/toaster";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";

export type KeyType = "personal" | "service";
export type PermissionMode = "all" | "restricted";

/** One row of the list. A key shows its prefix only; the rest of the secret is never kept. */
export interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  keyType: KeyType;
  scope: string;
  created: string;
  lastUsed: string;
}

/** What the drawer collects. `expiry` stays empty until chosen, so "No expiration" is a choice. */
export interface KeyDraft {
  name: string;
  description: string;
  keyType: KeyType;
  expiry: string;
  scopes: ScopeTriadEntry[];
  permissionMode: PermissionMode;
  permissions: string[];
}

/** What your API answers once, when the key is created. The token is not retrievable later. */
export interface IssuedKey {
  token: string;
  prefix: string;
}

/** Your API's create. It resolves with the new key and rejects with a readable message. */
export type CreateKey = (draft: KeyDraft) => Promise<IssuedKey>;

/** How a value reaches the clipboard. It rejects when the browser refuses. */
export type WriteToClipboard = (text: string) => Promise<void>;

type Field = "name" | "scope" | "permissions" | "expiry";
type Problems = Partial<Record<Field, string>>;

interface FormState extends KeyDraft {
  /** Set once the reader has pressed Create, so untouched fields are not shouted at. */
  attempted: boolean;
  pending: boolean;
  /** A refusal that is still true of the whole form, shown above the fields. */
  failure?: string;
}

/** The key just created, held by the page only until the reveal is dismissed. */
interface Revealed {
  name: string;
  token: string;
  scopes: ScopeTriadEntry[];
}

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface ApiKeyFlowStart {
  keys?: ApiKeyRow[];
  form?: Partial<FormState>;
  reveal?: Partial<Revealed> & { copied?: boolean; copyFailed?: boolean };
}

const TODAY = "11 Oct 2026";
const DOCS = "https://docs.langwatch.ai/api-reference/introduction";
const ENDPOINT = "https://app.langwatch.ai";
const COPIED_MS = 2000;

/** An example only: it opens nothing and is not derived from any real key. */
export const FAKE_TOKEN = "sk-lw-a1b2c3_EXAMPLE-not-a-real-key-0000";
const FAKE_PREFIX = "sk-lw-a1b2c3…";

const ORGANIZATION = { id: "org-acme", name: "Acme" };
const TEAMS = [
  { id: "team-cx", name: "Customer experience" },
  { id: "team-research", name: "Research" },
];
const PROJECTS = [
  { id: "proj-support", name: "Support assistant", teamId: "team-cx" },
  { id: "proj-billing", name: "Billing assistant", teamId: "team-cx" },
];
const CURRENT_PROJECT = "proj-support";

const EXPIRY_OPTIONS = [
  { value: "never", label: "No expiration" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/** A fixed list for the example: your application decides what a caller may grant. */
const PERMISSIONS = [
  { value: "traces:read", label: "Read traces" },
  { value: "datasets:read", label: "Read datasets" },
  { value: "datasets:write", label: "Write datasets" },
  { value: "prompts:read", label: "Read prompts" },
];

export const SEED_KEYS: ApiKeyRow[] = [
  {
    id: 1,
    name: "CI pipeline",
    prefix: "sk-lw-7f3a9c…",
    keyType: "service",
    scope: "Support assistant",
    created: "2 Oct 2026",
    lastUsed: "10 Oct 2026",
  },
  {
    id: 2,
    name: "Local development",
    prefix: "sk-lw-2d81e4…",
    keyType: "personal",
    scope: "Support assistant",
    created: "5 Oct 2026",
    lastUsed: "11 Oct 2026",
  },
];

/** A stand-in for your API: the key is made straight away. Pass your own to call a real one. */
const createLocally: CreateKey = () => Promise.resolve({ token: FAKE_TOKEN, prefix: FAKE_PREFIX });

/** A stand-in for the clipboard seam. Pass your own to count copies or to refuse one. */
const writeToClipboard: WriteToClipboard = (text) => navigator.clipboard.writeText(text);

function newDraft(): KeyDraft {
  return {
    name: "",
    description: "",
    keyType: "personal",
    expiry: "",
    scopes: [{ scopeType: "PROJECT", scopeId: CURRENT_PROJECT }],
    permissionMode: "all",
    permissions: [],
  };
}

function formFrom(overrides: Partial<FormState> = {}): FormState {
  return { ...newDraft(), attempted: false, pending: false, ...overrides };
}

const FIELD_ORDER: Field[] = ["name", "scope", "permissions", "expiry"];

function problemsOf(draft: KeyDraft): Problems {
  const problems: Problems = {};
  if (draft.name.trim() === "") problems.name = "Enter a name for this key.";
  if (draft.scopes.length === 0) problems.scope = "Choose where this key can be used.";
  if (draft.permissionMode === "restricted" && draft.permissions.length === 0) {
    problems.permissions = "Choose at least one permission, or switch to All.";
  }
  if (draft.expiry === "") {
    problems.expiry = "Choose when this key expires, or select No expiration.";
  }
  return problems;
}

/** The projects a key with these scopes can reach: the only ones a snippet may name. */
function reachableProjects(scopes: ScopeTriadEntry[]) {
  return PROJECTS.filter((project) =>
    scopes.some(
      (scope) =>
        scope.scopeType === "ORGANIZATION" ||
        (scope.scopeType === "TEAM" && scope.scopeId === project.teamId) ||
        (scope.scopeType === "PROJECT" && scope.scopeId === project.id),
    ),
  );
}

function describeScope(scopes: ScopeTriadEntry[]): string {
  const [first] = scopes;
  if (!first) return "No scope";
  if (scopes.length > 1) return `${scopes.length} scopes`;
  if (first.scopeType === "ORGANIZATION") return `${ORGANIZATION.name} (organisation)`;
  const named =
    first.scopeType === "TEAM"
      ? TEAMS.find((team) => team.id === first.scopeId)
      : PROJECTS.find((project) => project.id === first.scopeId);
  return named?.name ?? first.scopeId;
}

function maskKey(token: string): string {
  return `${token.slice(0, 6)}••••${token.slice(-4)}`;
}

function agentPrompt(): string {
  return 'Create a LangWatch API key called "CI pipeline" for the Support assistant project and store it as LANGWATCH_API_KEY in our CI secrets.';
}

function focusWithin(element: HTMLElement | null) {
  element
    ?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex='0']")
    ?.focus();
}

/** Whether your API made the key: the key when it did, the reason when it did not. */
async function issue({
  create,
  draft,
}: {
  create: CreateKey;
  draft: KeyDraft;
}): Promise<{ issued: IssuedKey } | { failure: string }> {
  try {
    return { issued: await create(draft) };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : "The key could not be created." };
  }
}

function initialRevealOf(reveal: ApiKeyFlowStart["reveal"]): Revealed | undefined {
  if (!reveal) return undefined;
  return {
    name: "Release pipeline",
    token: FAKE_TOKEN,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: ORGANIZATION.id }],
    ...reveal,
  };
}

interface FieldTargets {
  nameInput: RefObject<HTMLInputElement | null>;
  scopeBox: RefObject<HTMLDivElement | null>;
  permissionsBox: RefObject<HTMLDivElement | null>;
  expiryField: RefObject<HTMLSelectElement | null>;
}

function focusField({ field, targets }: { field: Field; targets: FieldTargets }) {
  if (field === "name") targets.nameInput.current?.focus();
  if (field === "scope") focusWithin(targets.scopeBox.current);
  if (field === "permissions") focusWithin(targets.permissionsBox.current);
  if (field === "expiry") targets.expiryField.current?.focus();
}

function rowFor({ id, draft, issued }: { id: number; draft: KeyDraft; issued: IssuedKey }) {
  return {
    id,
    name: draft.name.trim(),
    prefix: issued.prefix,
    keyType: draft.keyType,
    scope: describeScope(draft.scopes),
    created: TODAY,
    lastUsed: "Never used",
  } satisfies ApiKeyRow;
}

/** The credential table: the prefix and facts about a key, never the secret. No selection. */
function KeysTable({ keys }: { keys: ApiKeyRow[] }) {
  return (
    <ListTable aria-label="API keys" scroll="x" scrollLabel="API keys" minWidth="44rem">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Secret key</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Type</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Scope</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last used</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {keys.map((key) => (
          <ListTable.Row key={key.id} data-key-id={key.id}>
            <ListTable.Cell>{key.name}</ListTable.Cell>
            <ListTable.Cell>
              <InlineCode variant="neutral">{key.prefix}</InlineCode>
            </ListTable.Cell>
            <ListTable.Cell tone="muted">
              {key.keyType === "service" ? "Service key" : "Personal key"}
            </ListTable.Cell>
            <ListTable.Cell>{key.scope}</ListTable.Cell>
            <ListTable.Cell tone="muted">{key.lastUsed}</ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

/**
 * API keys list, a create Drawer, and a one-time reveal Dialog. The application owns `create`,
 * the clipboard and the real data; this owns the shapes and the short-lived token state.
 */
export function ApiKeyFlow({
  create = createLocally,
  copyToClipboard = writeToClipboard,
  start = {},
}: {
  create?: CreateKey;
  copyToClipboard?: WriteToClipboard;
  start?: ApiKeyFlowStart;
}) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(start.keys ?? SEED_KEYS);
  const [form, setForm] = useState<FormState | undefined>(() =>
    start.form ? formFrom(start.form) : undefined,
  );
  const [formOpen, setFormOpen] = useState(start.form !== undefined);
  const [revealed, setRevealed] = useState(() => initialRevealOf(start.reveal));
  const [revealOpen, setRevealOpen] = useState(start.reveal !== undefined);
  const nextId = useRef(Math.max(0, ...keys.map((key) => key.id)) + 1);
  const newButton = useRef<HTMLButtonElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const targets: FieldTargets = {
    nameInput: useRef<HTMLInputElement>(null),
    scopeBox: useRef<HTMLDivElement>(null),
    permissionsBox: useRef<HTMLDivElement>(null),
    expiryField: useRef<HTMLSelectElement>(null),
  };

  const patch = (change: Partial<FormState>) =>
    setForm((current) => (current ? { ...current, ...change } : current));

  const openCreate = () => {
    setForm(formFrom());
    setFormOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || form.pending) return;
    patch({ attempted: true, failure: undefined });
    const problems = problemsOf(form);
    const first = FIELD_ORDER.find((field) => problems[field]);
    if (first) return focusField({ field: first, targets });

    patch({ pending: true });
    const outcome = await issue({ create, draft: form });
    if ("failure" in outcome) return patch({ pending: false, failure: outcome.failure });

    const row = rowFor({ id: nextId.current++, draft: form, issued: outcome.issued });
    setKeys((current) => [...current, row]);
    setRevealed({ name: row.name, token: outcome.issued.token, scopes: form.scopes });
    patch({ pending: false });
    setFormOpen(false);
  };

  /** The drawer is gone before the reveal opens, so two overlays never stack. */
  const afterDrawer = () => {
    if (revealed) setRevealOpen(true);
    else newButton.current?.focus();
  };

  const closeReveal = () => {
    setRevealOpen(false);
    setRevealed(undefined);
  };

  return (
    <ProductScope product={null}>
      <ListPage
        title="API keys"
        description="Keys that let your code and tools talk to LangWatch. Do not share them or put them in client-side code."
        actions={
          <PageLayout.HeaderButton primary ref={newButton} onClick={openCreate}>
            Create new secret key
          </PageLayout.HeaderButton>
        }
        state={keys.length === 0 ? "empty" : "ready"}
        empty={{
          size: "line",
          title: "No API keys yet. A key lets your code send traces and read your data.",
          next: [
            { kind: "docs", label: "Read about API keys", href: DOCS },
            { kind: "agent-prompt", prompt: agentPrompt() },
          ],
        }}
      >
        <KeysTable keys={keys} />
      </ListPage>

      {form && (
        <CreateKeyDrawer
          form={form}
          open={formOpen}
          onChange={patch}
          onClose={() => setFormOpen(false)}
          onSubmit={submit}
          onExitComplete={afterDrawer}
          refs={targets}
        />
      )}

      <Dialog
        open={revealOpen && revealed !== undefined}
        onClose={closeReveal}
        title="Token created"
        size="xl"
        cancelLabel={null}
        closeOnInteractOutside={false}
        initialFocusEl={() => copyButton.current}
        finalFocusEl={() => newButton.current}
        primaryAction={{ label: "Done", onClick: closeReveal }}
      >
        {revealed && (
          <RevealBody
            key={revealed.token}
            revealed={revealed}
            copyToClipboard={copyToClipboard}
            copyButton={copyButton}
            initial={{ copied: start.reveal?.copied, copyFailed: start.reveal?.copyFailed }}
          />
        )}
      </Dialog>

      <Toaster />
    </ProductScope>
  );
}

function CreateKeyDrawer({
  form,
  open,
  onChange,
  onClose,
  onSubmit,
  onExitComplete,
  refs,
}: {
  form: FormState;
  open: boolean;
  onChange: (change: Partial<FormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onExitComplete: () => void;
  refs: FieldTargets;
}) {
  const problems = form.attempted ? problemsOf(form) : {};
  const selected = form.permissions.length;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Create new secret key"
      size="lg"
      busy={form.pending}
      onSubmit={onSubmit}
      initialFocusEl={() => refs.nameInput.current}
      onExitComplete={onExitComplete}
      footer={{
        cancel: { onClick: onClose },
        primaryAction: { label: "Create secret key", type: "submit", loading: form.pending },
      }}
    >
      <Stack gap={5}>
        {form.failure && (
          <Banner
            status="error"
            placement="inline"
            title="Couldn't create the key"
            action={
              <EmptyNextSteps next={[{ kind: "docs", label: "Read about API keys", href: DOCS }]} />
            }
          >
            {form.failure} Nothing was created and what you entered is still here: create again to
            retry.
          </Banner>
        )}
        <SettingsFieldGroup>
          <SettingsField label="Key type" disabled={form.pending}>
            <Stack gap={2} align="start" width="full">
              <SegmentedControl
                size="sm"
                items={[
                  { value: "personal", label: "Personal" },
                  { value: "service", label: "Service" },
                ]}
                value={form.keyType}
                onValueChange={({ value }) =>
                  onChange({ keyType: value === "service" ? "service" : "personal" })
                }
              />
              <Text textStyle="caption" color="fg.muted">
                {form.keyType === "personal"
                  ? "Tied to you. If you leave the organisation, this key is disabled."
                  : "Not tied to any user, so it keeps working when people leave. Set permissions below."}
              </Text>
            </Stack>
          </SettingsField>

          <SettingsField label="Name" error={problems.name} disabled={form.pending}>
            <Input
              ref={refs.nameInput}
              placeholder="e.g., CI pipeline, Local development"
              value={form.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </SettingsField>

          <SettingsField label="Description (optional)" disabled={form.pending}>
            <Textarea
              placeholder="What is this key used for?"
              rows={3}
              maxLength={500}
              resize="vertical"
              value={form.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </SettingsField>

          <SettingsField label="Scope" error={problems.scope} disabled={form.pending}>
            <Box ref={refs.scopeBox} width="full">
              <ScopeChipPicker
                label=""
                subjectNoun="key"
                showQuickPicks
                value={form.scopes}
                onChange={(scopes) => onChange({ scopes, permissions: [] })}
                organizationId={ORGANIZATION.id}
                organizationName={ORGANIZATION.name}
                availableTeams={TEAMS}
                availableProjects={PROJECTS}
                currentOrganizationId={ORGANIZATION.id}
                currentTeamId="team-cx"
                currentProjectId={CURRENT_PROJECT}
              />
            </Box>
          </SettingsField>

          <SettingsField label="Permissions" error={problems.permissions} disabled={form.pending}>
            <Stack ref={refs.permissionsBox} gap={2} align="start" width="full">
              <HStack justify="space-between" width="full">
                <SegmentedControl
                  size="sm"
                  items={[
                    { value: "all", label: "All" },
                    { value: "restricted", label: "Restricted" },
                  ]}
                  value={form.permissionMode}
                  onValueChange={({ value }) =>
                    onChange({
                      permissionMode: value === "restricted" ? "restricted" : "all",
                      permissions: [],
                    })
                  }
                />
                {form.permissionMode === "restricted" && (
                  <Text textStyle="caption" color="fg.muted">
                    {selected} of {PERMISSIONS.length} selected
                  </Text>
                )}
              </HStack>
              {form.permissionMode === "all" ? (
                <Text textStyle="caption" color="fg.muted">
                  Full access within the selected scope, bounded by your role.
                </Text>
              ) : (
                <Stack gap={2}>
                  {PERMISSIONS.map((permission) => (
                    <Checkbox
                      key={permission.value}
                      checked={form.permissions.includes(permission.value)}
                      onChange={(event) =>
                        onChange({
                          permissions: event.target.checked
                            ? [...form.permissions, permission.value]
                            : form.permissions.filter((value) => value !== permission.value),
                        })
                      }
                    >
                      {permission.label}
                    </Checkbox>
                  ))}
                </Stack>
              )}
            </Stack>
          </SettingsField>

          <SettingsField
            label="Expiration"
            hint={problems.expiry ? undefined : "A key stops working on this date."}
            error={problems.expiry}
            disabled={form.pending}
          >
            <NativeSelect.Root width="full">
              <NativeSelect.Field
                ref={refs.expiryField}
                value={form.expiry}
                onChange={(event) => onChange({ expiry: event.target.value })}
              >
                <option value="" disabled>
                  Choose when this key expires
                </option>
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </SettingsField>
        </SettingsFieldGroup>
      </Stack>
    </Drawer>
  );
}

type Format = "env" | "bearer";

function RevealBody({
  revealed,
  copyToClipboard,
  copyButton,
  initial,
}: {
  revealed: Revealed;
  copyToClipboard: WriteToClipboard;
  copyButton: RefObject<HTMLButtonElement | null>;
  initial: { copied?: boolean; copyFailed?: boolean };
}) {
  const { token, name, scopes } = revealed;
  const [copyFailed, setCopyFailed] = useState(initial.copyFailed ?? false);
  const [shown, setShown] = useState(false);
  const [format, setFormat] = useState<Format>("env");
  const [chosen, setChosen] = useState<string>();
  const valueBox = useRef<HTMLDivElement>(null);
  const [selectRequests, setSelectRequests] = useState(0);

  /** Copies the real value and says so; a refused copy says that instead and claims nothing. */
  const copy: SnippetCopy = async ({ text, what }) => {
    try {
      await copyToClipboard(text);
    } catch {
      setCopyFailed(true);
      return false;
    }
    setCopyFailed(false);
    toaster.create({
      type: "success",
      title: "Copied",
      description: `${what} copied to clipboard`,
    });
    return true;
  };

  useEffect(() => {
    if (selectRequests === 0) return;
    const node = valueBox.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [selectRequests]);

  const projects = reachableProjects(scopes);
  const [only, ...others] = projects;
  const projectId =
    others.length === 0
      ? only?.id
      : projects.find((project) => project.id === (chosen ?? CURRENT_PROJECT))?.id;
  const withoutProject =
    projects.length === 0
      ? "No project is reachable with this key, so there is no project ID to fill in here. The API key above can still be copied."
      : "Select a project to fill in this snippet.";

  const env = projectId
    ? [
        `LANGWATCH_API_KEY="${token}"`,
        `LANGWATCH_PROJECT_ID="${projectId}"`,
        `LANGWATCH_ENDPOINT="${ENDPOINT}"`,
      ].join("\n")
    : "";
  const bearer = projectId ? `Authorization: Bearer ${token}\nX-Project-Id: ${projectId}` : "";

  return (
    <Stack gap={6} align="stretch">
      <Stack gap={3} align="stretch">
        <Card
          variant="nested"
          padding="sm"
          titleLevel={3}
          title={name}
          description="Your new secret key"
        >
          <HStack gap={2} flexWrap="wrap" align="center">
            <Box ref={valueBox} flex="1 1 12rem" minWidth={0}>
              <InlineCode
                variant="neutral"
                height="auto"
                whiteSpace="normal"
                wordBreak="break-all"
                overflow="visible"
                textOverflow="clip"
              >
                {shown ? token : maskKey(token)}
              </InlineCode>
            </Box>
            <Button size="xs" variant="ghost" aria-pressed={shown} onClick={() => setShown(!shown)}>
              {shown ? "Hide key" : "Show key"}
            </Button>
            <CopyKeyButton token={token} copy={copy} buttonRef={copyButton} initial={initial} />
          </HStack>
        </Card>
        {copyFailed && (
          <Banner
            status="error"
            placement="inline"
            title="Couldn't copy to the clipboard."
            action={
              <BannerAction
                onClick={() => {
                  setShown(true);
                  setSelectRequests(selectRequests + 1);
                }}
              >
                Select the key
              </BannerAction>
            }
          >
            Select the key and copy it by hand, or try again.
          </Banner>
        )}
      </Stack>

      <Stack as="section" aria-label="Use in code" gap={3} align="stretch">
        <HStack gap={4} align="start" justify="space-between" flexWrap="wrap">
          <Text textStyle="cardTitle">Use in code</Text>
          {only && others.length === 0 && (
            <HStack gap={2}>
              <Text textStyle="caption" color="fg.muted">
                Project
              </Text>
              <Text textStyle="caption" fontWeight="semibold">
                {only.name}
              </Text>
            </HStack>
          )}
          {others.length > 0 && (
            <NativeSelect.Root size="sm" width={{ base: "full", sm: "200px" }}>
              <NativeSelect.Field
                aria-label="Project"
                value={projectId ?? ""}
                onChange={(event) => setChosen(event.target.value)}
              >
                {projectId === undefined && <option value="">Select a project</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          )}
        </HStack>
        <ContentTabs<Format>
          label="Use in code format"
          value={format}
          onValueChange={({ value }) => setFormat(value)}
          body="flush"
          mount="active"
          items={[
            {
              value: "env",
              label: ".env",
              content: (
                <Box paddingTop={3}>
                  {env ? (
                    <SnippetPreview
                      copy={copy}
                      code={env}
                      copyText={env}
                      filename=".env"
                      codeLanguage="ini"
                      sensitiveValue={token}
                      enableVisibilityToggle
                    />
                  ) : (
                    <SnippetNote>{withoutProject}</SnippetNote>
                  )}
                </Box>
              ),
            },
            {
              value: "bearer",
              label: "Bearer",
              content: (
                <Stack gap={1} align="stretch" paddingTop={3}>
                  <Text textStyle="caption" color="fg.muted">
                    Send the <InlineCode>Authorization</InlineCode> header with{" "}
                    <InlineCode>X-Project-Id</InlineCode> on every request:
                  </Text>
                  {bearer ? (
                    <SnippetPreview
                      copy={copy}
                      code={bearer}
                      copyText={bearer}
                      filename="HTTP headers"
                      codeLanguage="shellscript"
                      sensitiveValue={token}
                      enableVisibilityToggle
                    />
                  ) : (
                    <SnippetNote>{withoutProject}</SnippetNote>
                  )}
                </Stack>
              ),
            },
          ]}
        />
      </Stack>

      <Banner status="warning" placement="inline">
        Copy this key now. You won&apos;t be able to see it again.
      </Banner>
    </Stack>
  );
}

function SnippetNote({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="caption" color="fg.muted">
      {children}
    </Text>
  );
}

/** One button that says Copied only after the clipboard took the key. */
function CopyKeyButton({
  token,
  copy,
  buttonRef,
  initial,
}: {
  token: string;
  copy: SnippetCopy;
  buttonRef: RefObject<HTMLButtonElement | null>;
  initial: { copied?: boolean };
}) {
  const [copied, setCopied] = useState(initial.copied ?? false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copyKey = async () => {
    setCopied(false);
    if (!(await copy({ text: token, what: "API key" }))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <Button
      ref={buttonRef}
      size="sm"
      variant="outline"
      colorPalette={copied ? "green" : "gray"}
      onClick={() => void copyKey()}
    >
      {copied ? "Copied" : "Copy API key"}
    </Button>
  );
}
