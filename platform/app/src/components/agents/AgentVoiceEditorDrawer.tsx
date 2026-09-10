import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Link,
  NativeSelect,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import { showErrorToast } from "~/features/errors";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { AgentWithFields } from "~/server/agents/agent-fields";
import {
  E164_PHONE_PATTERN,
  VOICE_TRANSPORT_LABELS,
  VOICE_TRANSPORTS,
  type VoiceTransport,
} from "~/server/agents/voice/voice-agent.config";
import { api } from "~/utils/api";
import { TalkToItPanel } from "./voice/TalkToItPanel";
import { useVoiceAgentsEnabled } from "./voice/useVoiceAgentsEnabled";

// ============================================================================
// Constants
// ============================================================================

/** The transport a new voice agent is reached through, until phone lands. */
const DEFAULT_TRANSPORT: VoiceTransport = "elevenlabs_convai";

/** The settings route that adds a model provider key. Top-level, no slug. */
const MODEL_PROVIDERS_ROUTE = "/settings/model-providers";

// ============================================================================
// Draft persistence (survives the detour to Model providers)
// ============================================================================

type VoiceAgentDraft = {
  name: string;
  transport: VoiceTransport;
  agentId: string;
  phoneNumber: string;
};

/**
 * What actually reaches sessionStorage. The phone number is deliberately absent:
 * it is a personal identifier and CodeQL flags storing it in clear text, so the
 * draft never persists it. A saved phone target still shows its number on reopen
 * (that comes from the agent record), so only an unsaved, in-progress number is
 * lost across the detour to add a key.
 */
type PersistedVoiceAgentDraft = Omit<VoiceAgentDraft, "phoneNumber">;

const draftKey = (projectId: string) => `voice-agent-draft:${projectId}`;

function readDraft(projectId: string): VoiceAgentDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedVoiceAgentDraft>;
    if (typeof parsed.agentId !== "string" || typeof parsed.name !== "string") {
      return null;
    }
    const transport = VOICE_TRANSPORTS.includes(
      parsed.transport as VoiceTransport,
    )
      ? (parsed.transport as VoiceTransport)
      : DEFAULT_TRANSPORT;
    return {
      name: parsed.name,
      transport,
      agentId: parsed.agentId,
      // Never read from storage: the phone number is not persisted.
      phoneNumber: "",
    };
  } catch {
    return null;
  }
}

function writeDraft(projectId: string, draft: PersistedVoiceAgentDraft): void {
  try {
    // Only the non-sensitive fields are stored; phoneNumber is never persisted.
    const persisted: PersistedVoiceAgentDraft = {
      name: draft.name,
      transport: draft.transport,
      agentId: draft.agentId,
    };
    sessionStorage.setItem(draftKey(projectId), JSON.stringify(persisted));
  } catch {
    // sessionStorage may be unavailable (private mode, quota); the draft is a
    // convenience, so a failure to persist is silent.
  }
}

function clearDraft(projectId: string): void {
  try {
    sessionStorage.removeItem(draftKey(projectId));
  } catch {
    // See writeDraft.
  }
}

// ============================================================================
// Props
// ============================================================================

export type AgentVoiceEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: AgentWithFields) => void;
  /** If provided, loads an existing agent for editing. */
  agentId?: string;
};

// ============================================================================
// Pure helpers
// ============================================================================

type VoiceForm = {
  name: string;
  transport: VoiceTransport;
  agentId: string;
  phoneNumber: string;
};

/** The form values seeded from a saved agent's stored config. */
function formFromAgent(agentData: {
  name?: string | null;
  config?: unknown;
}): VoiceForm {
  const config = (agentData.config ?? {}) as {
    transport?: VoiceTransport;
    agentId?: string;
    phoneNumber?: string;
  };
  return {
    name: agentData.name ?? "",
    transport: config.transport ?? DEFAULT_TRANSPORT,
    agentId: config.agentId ?? "",
    phoneNumber: config.phoneNumber ?? "",
  };
}

/** The form values seeded from the per-project create draft (else empty). */
function formFromDraft(projectId: string): VoiceForm {
  const draft = readDraft(projectId);
  return {
    name: draft?.name ?? "",
    transport: draft?.transport ?? DEFAULT_TRANSPORT,
    agentId: draft?.agentId ?? "",
    phoneNumber: draft?.phoneNumber ?? "",
  };
}

/**
 * The values the form initializes to: the saved agent when editing, the draft
 * (else empty) when creating, or null when there is nothing to seed from yet.
 */
function resolveInitialForm({
  agentData,
  isCreating,
  isOpen,
  projectId,
}: {
  agentData: { name?: string | null; config?: unknown } | null | undefined;
  isCreating: boolean;
  isOpen: boolean;
  projectId: string;
}): VoiceForm | null {
  if (agentData) return formFromAgent(agentData);
  if (isCreating && isOpen && projectId) return formFromDraft(projectId);
  return null;
}

/**
 * Whether the project has an ElevenLabs key that can sign a session. The key
 * value is never read — only whether an enabled ElevenLabs provider row carries
 * one (or the system key).
 */
function hasElevenLabsKeyIn(
  providers: readonly Record<string, unknown>[],
): boolean {
  return providers.some(
    (row) =>
      row.provider === "elevenlabs" &&
      row.enabled &&
      (row.isSystem ||
        Boolean(
          (row.customKeys as Record<string, unknown> | null | undefined)
            ?.ELEVENLABS_API_KEY,
        )),
  );
}

/**
 * Whether the project has a Twilio provider that can dial a phone target.
 * Unlike {@link hasElevenLabsKeyIn}, `isSystem` alone cannot satisfy this: a
 * system row's `enabled` flag only reflects `TWILIO_AUTH_TOKEN`, and the
 * server never fills in a system row's customKeys, so it carries no signal
 * for the other two fields. All three are required to place a call, so the
 * option is offered only when a row's own customKeys carry all three.
 */
function hasTwilioKeyIn(
  providers: readonly Record<string, unknown>[],
): boolean {
  return providers.some((row) => {
    if (row.provider !== "twilio" || !row.enabled) return false;
    const keys = row.customKeys as Record<string, unknown> | null | undefined;
    return (
      Boolean(keys?.TWILIO_ACCOUNT_SID) &&
      Boolean(keys?.TWILIO_AUTH_TOKEN) &&
      Boolean(keys?.TWILIO_FROM_NUMBER)
    );
  });
}

/**
 * Resolve the drawer inputs from its three overlapping sources: explicit props,
 * the flow callbacks the run dialog forwards, and the drawer's URL/complex props.
 */
function resolveEditorInputs({
  props,
  closeDrawer,
  complexProps,
  drawerParams,
  flowCallbacksForSave,
}: {
  props: AgentVoiceEditorDrawerProps;
  closeDrawer: () => void;
  complexProps: Record<string, unknown>;
  drawerParams: { agentId?: string };
  flowCallbacksForSave:
    | { onSave?: (agent: AgentWithFields) => void }
    | undefined;
}): {
  onClose: () => void;
  onSave: AgentVoiceEditorDrawerProps["onSave"];
  agentId: string | undefined;
  isOpen: boolean;
  isCreating: boolean;
} {
  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    flowCallbacksForSave?.onSave ??
    (complexProps.onSave as AgentVoiceEditorDrawerProps["onSave"]);
  const agentId =
    props.agentId ??
    drawerParams.agentId ??
    (complexProps.agentId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;
  return { onClose, onSave, agentId, isOpen, isCreating: !agentId };
}

/** The Add-key detour carries the current URL back so we return with the draft. */
function addKeyHref(): string {
  if (typeof window === "undefined") return MODEL_PROVIDERS_ROUTE;
  const returnTo = encodeURIComponent(window.location.href);
  return `${MODEL_PROVIDERS_ROUTE}?returnTo=${returnTo}`;
}

/** The name and the transport's own required field are filled, so the agent
 *  can be saved. Phone validates the number in E.164 form; ElevenLabs needs a
 *  non-empty agent id. */
function isVoiceFormValid(form: {
  name: string;
  transport: VoiceTransport;
  voiceAgentId: string;
  phoneNumber: string;
}): boolean {
  if (form.name.trim().length === 0) return false;
  if (form.transport === "phone") {
    return E164_PHONE_PATTERN.test(form.phoneNumber.trim());
  }
  return form.voiceAgentId.trim().length > 0;
}

/** The tooltip naming whichever "Talk to it" prerequisite is still missing. */
function talkTooltipFor({
  transport,
  voiceAgentId,
  hasElevenLabsKey,
}: {
  transport: VoiceTransport;
  voiceAgentId: string;
  hasElevenLabsKey: boolean;
}): string | undefined {
  if (transport === "phone") {
    return "Browser calls are not available for phone targets. Call it from a scenario run.";
  }
  if (voiceAgentId.trim().length === 0) return "Enter the agent id first";
  if (!hasElevenLabsKey) return "Add an ElevenLabs key first";
  return undefined;
}

// ============================================================================
// Hooks
// ============================================================================

type ApiUtils = ReturnType<typeof api.useUtils>;

/** Form fields plus the effects that seed and persist them per drawer session. */
function useVoiceFormState({
  agentData,
  agentId,
  isCreating,
  isOpen,
  projectId,
}: {
  agentData: { name?: string | null; config?: unknown } | null | undefined;
  agentId: string | undefined;
  isCreating: boolean;
  isOpen: boolean;
  projectId: string;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<VoiceTransport>(DEFAULT_TRANSPORT);
  const [voiceAgentId, setVoiceAgentId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const formInitializedRef = useRef(false);
  const lastAgentIdRef = useRef<string | undefined>(undefined);

  // Initialize once per drawer session.
  useEffect(() => {
    if (lastAgentIdRef.current !== agentId) {
      formInitializedRef.current = false;
      lastAgentIdRef.current = agentId;
    }
    if (formInitializedRef.current) return;
    const initial = resolveInitialForm({
      agentData,
      isCreating,
      isOpen,
      projectId,
    });
    if (!initial) return;
    setName(initial.name);
    setTransport(initial.transport);
    setVoiceAgentId(initial.agentId);
    setPhoneNumber(initial.phoneNumber);
    formInitializedRef.current = true;
  }, [agentData, agentId, isCreating, isOpen, projectId]);

  // Reset the init flag when the drawer closes so the next open re-initializes.
  useEffect(() => {
    if (!isOpen) formInitializedRef.current = false;
  }, [isOpen]);

  // Persist the draft on every change while creating, so the detour to add a
  // key returns to a filled drawer.
  useEffect(() => {
    if (!isCreating || !isOpen || !projectId || !formInitializedRef.current) {
      return;
    }
    writeDraft(projectId, {
      name,
      transport,
      agentId: voiceAgentId,
    });
  }, [isCreating, isOpen, projectId, name, transport, voiceAgentId]);

  return {
    name,
    setName,
    transport,
    setTransport,
    voiceAgentId,
    setVoiceAgentId,
    phoneNumber,
    setPhoneNumber,
  };
}

/** The create/update mutations, wired to invalidate, notify onSave and close. */
function useVoiceAgentMutations({
  projectId,
  onSave,
  onClose,
}: {
  projectId: string;
  onSave: AgentVoiceEditorDrawerProps["onSave"];
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const createMutation = api.agents.create.useMutation({
    onSuccess: (agent) => {
      if (projectId) clearDraft(projectId);
      void utils.agents.getAll.invalidate({ projectId });
      onSave?.(agent);
      onClose();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't create agent" }),
  });
  const updateMutation = api.agents.update.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId });
      void utils.agents.getById.invalidate({ id: agent.id, projectId });
      onSave?.(agent);
      onClose();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't save agent" }),
  });
  return { createMutation, updateMutation, utils };
}

/** The agent (when editing) and whether the project has an ElevenLabs key. */
function useVoiceAgentData({
  agentId,
  projectId,
  isOpen,
}: {
  agentId: string | undefined;
  projectId: string;
  isOpen: boolean;
}) {
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId },
    { enabled: !!agentId && !!projectId && isOpen },
  );
  const providersQuery =
    api.modelProvider.listAllForProjectForFrontend.useQuery(
      { projectId },
      { enabled: !!projectId && isOpen },
    );
  const providers = providersQuery.data?.providers ?? [];
  const hasElevenLabsKey = hasElevenLabsKeyIn(providers);
  const hasTwilioKey = hasTwilioKeyIn(providers);
  return { agentQuery, hasElevenLabsKey, hasTwilioKey };
}

/**
 * Create or update the voice agent from the current form, when valid.
 *
 * `agentId` is the editor's own prop id (an existing agent opened for edit);
 * `createdAgentRowId` is the row "Talk to it" created mid-session for a
 * still-unsaved draft. Once either is set, Save must update that row rather
 * than insert a duplicate (#20).
 */
function submitVoiceAgent({
  projectId,
  isValid,
  agentId,
  createdAgentRowId,
  form,
  createMutation,
  updateMutation,
}: {
  projectId: string;
  isValid: boolean;
  agentId: string | undefined;
  createdAgentRowId: string | undefined;
  form: {
    name: string;
    transport: VoiceTransport;
    voiceAgentId: string;
    phoneNumber: string;
  };
  createMutation: ReturnType<typeof api.agents.create.useMutation>;
  updateMutation: ReturnType<typeof api.agents.update.useMutation>;
}): void {
  if (!projectId || !isValid) return;
  const config =
    form.transport === "phone"
      ? { transport: form.transport, phoneNumber: form.phoneNumber.trim() }
      : { transport: form.transport, agentId: form.voiceAgentId.trim() };
  const savedAgentId = agentId ?? createdAgentRowId;
  if (savedAgentId) {
    updateMutation.mutate({
      id: savedAgentId,
      projectId,
      name: form.name.trim(),
      config,
    });
  } else {
    createMutation.mutate({
      projectId,
      name: form.name.trim(),
      type: "voice",
      config,
    });
  }
}

/** The memoized Save handler, split out so {@link useVoiceAgentEditor} stays
 *  within the file's line-per-function budget. */
function useSaveVoiceAgent({
  projectId,
  isValid,
  agentId,
  createdAgentRowId,
  form,
  createMutation,
  updateMutation,
}: {
  projectId: string;
  isValid: boolean;
  agentId: string | undefined;
  createdAgentRowId: string | undefined;
  form: {
    name: string;
    transport: VoiceTransport;
    voiceAgentId: string;
    phoneNumber: string;
  };
  createMutation: ReturnType<typeof api.agents.create.useMutation>;
  updateMutation: ReturnType<typeof api.agents.update.useMutation>;
}): { handleSave: () => void; hasAttemptedSubmit: boolean } {
  // Save is never disabled by validity (guidelines.md#213) — instead a failed
  // submit flips this so the invalid fields show their inline error.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const handleSave = useCallback(() => {
    setHasAttemptedSubmit(true);
    submitVoiceAgent({
      projectId,
      isValid,
      agentId,
      createdAgentRowId,
      form,
      createMutation,
      updateMutation,
    });
  }, [
    projectId,
    isValid,
    agentId,
    createdAgentRowId,
    form,
    createMutation,
    updateMutation,
  ]);
  return { handleSave, hasAttemptedSubmit };
}

/**
 * All the voice-editor state and callbacks the drawer and its views render from.
 *
 * Mirrors {@link AgentHttpEditorDrawer}: same onSave resolution, the same
 * create/update mutations, and the same flow-callback forwarding so the run
 * dialog and the scenario editor can open it and be told about the saved agent.
 */
/**
 * The drawer's resolved inputs, local state, and the data/form/mutation hooks
 * it composes. Kept apart from {@link useVoiceAgentEditor} so each stays a small
 * function; the editor hook layers the derived flags and callbacks on top.
 */
function useVoiceEditorState(props: AgentVoiceEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const projectId = project?.id ?? "";
  const drawerParams = useDrawerParams();
  const { onClose, onSave, agentId, isOpen, isCreating } = resolveEditorInputs({
    props,
    closeDrawer,
    complexProps: getComplexProps(),
    drawerParams,
    flowCallbacksForSave: getFlowCallbacks("agentVoiceEditor"),
  });
  // The card menu's Talk to it action opens the drawer straight onto the call
  // panel via ?drawer.talk=1, rather than making the user click Talk to it
  // again once the editor has loaded (#23).
  const [isTalkOpen, setIsTalkOpen] = useState(drawerParams.talk === "1");
  const [createdAgentRowId, setCreatedAgentRowId] = useState<string>();
  const { agentQuery, hasElevenLabsKey, hasTwilioKey } = useVoiceAgentData({
    agentId,
    projectId,
    isOpen,
  });
  const form = useVoiceFormState({
    agentData: agentQuery.data,
    agentId,
    isCreating,
    isOpen,
    projectId,
  });
  const { createMutation, updateMutation, utils } = useVoiceAgentMutations({
    projectId,
    onSave,
    onClose,
  });
  return {
    project,
    canGoBack,
    goBack,
    agentId,
    isOpen,
    isCreating,
    projectId,
    onClose,
    form,
    hasElevenLabsKey,
    hasTwilioKey,
    isTalkOpen,
    setIsTalkOpen,
    createdAgentRowId,
    setCreatedAgentRowId,
    agentQuery,
    createMutation,
    updateMutation,
    utils,
  };
}

function useVoiceAgentEditor(props: AgentVoiceEditorDrawerProps) {
  const state = useVoiceEditorState(props);
  const {
    projectId,
    onClose,
    agentId,
    form,
    createdAgentRowId,
    createMutation,
    updateMutation,
  } = state;

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isValid = isVoiceFormValid(form);

  const { handleSave, hasAttemptedSubmit } = useSaveVoiceAgent({
    projectId,
    isValid,
    agentId,
    createdAgentRowId,
    form,
    createMutation,
    updateMutation,
  });

  const handleClose = useCallback(() => {
    if (projectId) clearDraft(projectId);
    onClose();
  }, [projectId, onClose]);

  return {
    project: state.project,
    canGoBack: state.canGoBack,
    goBack: state.goBack,
    agentId,
    isOpen: state.isOpen,
    projectId,
    form,
    hasElevenLabsKey: state.hasElevenLabsKey,
    hasTwilioKey: state.hasTwilioKey,
    isSaving,
    isValid,
    hasAttemptedSubmit,
    isLoading: state.agentQuery.isLoading,
    isTalkOpen: state.isTalkOpen,
    setIsTalkOpen: state.setIsTalkOpen,
    createdAgentRowId,
    setCreatedAgentRowId: state.setCreatedAgentRowId,
    handleSave,
    handleClose,
    utils: state.utils,
  };
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * What the drawer shows while the project's `release_voice_agents_enabled`
 * flag is off (AC29): the same frame, one sentence, no form.
 */
function VoiceAgentsDisabledDrawer({
  editor,
}: {
  editor: ReturnType<typeof useVoiceAgentEditor>;
}) {
  return (
    <Drawer.Root
      open={editor.isOpen}
      onOpenChange={({ open }) => !open && editor.handleClose()}
      size="lg"
      modal={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <VoiceAgentHeader
          canGoBack={editor.canGoBack}
          goBack={editor.goBack}
          agentId={editor.agentId}
        />
        <Drawer.Body padding={6}>
          <Text data-testid="voice-agents-disabled-message">
            Voice agents are not enabled for this project.
          </Text>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * Drawer for creating/editing a voice agent. The credential comes from the
 * project's ElevenLabs provider row — the agent stores no secret — so the drawer
 * only says whether that key is present.
 */
export function AgentVoiceEditorDrawer(props: AgentVoiceEditorDrawerProps) {
  const editor = useVoiceAgentEditor(props);
  const { form } = editor;
  const voiceAgentsEnabled = useVoiceAgentsEnabled();

  if (!voiceAgentsEnabled) {
    return <VoiceAgentsDisabledDrawer editor={editor} />;
  }

  return (
    <Drawer.Root
      open={editor.isOpen}
      onOpenChange={({ open }) => !open && editor.handleClose()}
      size="lg"
      closeOnInteractOutside={false}
      modal={false}
      preventScroll={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <VoiceAgentHeader
          canGoBack={editor.canGoBack}
          goBack={editor.goBack}
          agentId={editor.agentId}
        />
        <VoiceAgentDrawerBody editor={editor} />
        <VoiceAgentFooter
          agentId={editor.agentId}
          createdAgentRowId={editor.createdAgentRowId}
          transport={form.transport}
          voiceAgentId={form.voiceAgentId}
          hasElevenLabsKey={editor.hasElevenLabsKey}
          isSaving={editor.isSaving}
          onCancel={editor.handleClose}
          onTalk={() => editor.setIsTalkOpen(true)}
          onSave={editor.handleSave}
        />
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Presentational sub-components
// ============================================================================

/**
 * The drawer body: the call panel, the loading spinner while an existing agent
 * loads, or the edit form. Split out of {@link AgentVoiceEditorDrawer} so that
 * component stays small.
 */
function VoiceAgentDrawerBody({
  editor,
}: {
  editor: ReturnType<typeof useVoiceAgentEditor>;
}) {
  const { form } = editor;
  return (
    <Drawer.Body
      display="flex"
      flexDirection="column"
      overflow="hidden"
      padding={0}
    >
      {editor.isTalkOpen ? (
        <VoiceAgentTalkView
          project={editor.project}
          projectId={editor.projectId}
          transport={form.transport}
          voiceAgentId={form.voiceAgentId}
          name={form.name}
          agentId={editor.agentId}
          createdAgentRowId={editor.createdAgentRowId}
          setCreatedAgentRowId={editor.setCreatedAgentRowId}
          utils={editor.utils}
          onBack={() => editor.setIsTalkOpen(false)}
        />
      ) : editor.agentId && editor.isLoading ? (
        <HStack justify="center" paddingY={8}>
          <Spinner size="md" />
        </HStack>
      ) : (
        <VoiceAgentForm
          name={form.name}
          setName={form.setName}
          transport={form.transport}
          setTransport={form.setTransport}
          voiceAgentId={form.voiceAgentId}
          setVoiceAgentId={form.setVoiceAgentId}
          phoneNumber={form.phoneNumber}
          setPhoneNumber={form.setPhoneNumber}
          hasTwilioKey={editor.hasTwilioKey}
          hasElevenLabsKey={editor.hasElevenLabsKey}
          hasAttemptedSubmit={editor.hasAttemptedSubmit}
        />
      )}
    </Drawer.Body>
  );
}

function VoiceAgentHeader({
  canGoBack,
  goBack,
  agentId,
}: {
  canGoBack: boolean;
  goBack: () => void;
  agentId: string | undefined;
}) {
  return (
    <Drawer.Header>
      <HStack gap={2}>
        {canGoBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            padding={1}
            minWidth="auto"
            data-testid="back-button"
          >
            <LuArrowLeft size={20} />
          </Button>
        )}
        <Heading>{agentId ? "Edit Voice Agent" : "New Voice Agent"}</Heading>
      </HStack>
    </Drawer.Header>
  );
}

function VoiceAgentTalkView({
  project,
  projectId,
  transport,
  voiceAgentId,
  name,
  agentId,
  createdAgentRowId,
  setCreatedAgentRowId,
  utils,
  onBack,
}: {
  project: { slug?: string } | null | undefined;
  projectId: string;
  transport: VoiceTransport;
  voiceAgentId: string;
  name: string;
  agentId: string | undefined;
  createdAgentRowId: string | undefined;
  setCreatedAgentRowId: (rowId: string) => void;
  utils: ApiUtils;
  onBack: () => void;
}) {
  return (
    <VStack
      gap={4}
      align="stretch"
      flex={1}
      overflowY="auto"
      paddingX={6}
      paddingY={4}
    >
      <Button
        variant="ghost"
        size="sm"
        alignSelf="flex-start"
        onClick={onBack}
        data-testid="voice-agent-talk-back"
      >
        <LuArrowLeft size={16} /> Back
      </Button>
      <TalkToItPanel
        projectId={projectId}
        projectSlug={project?.slug ?? ""}
        transport={transport}
        agentId={voiceAgentId.trim()}
        agentRowId={agentId ?? createdAgentRowId}
        name={name.trim() || undefined}
        onAgentCreated={(rowId) => {
          setCreatedAgentRowId(rowId);
          void utils.agents.getAll.invalidate({ projectId });
        }}
      />
    </VStack>
  );
}

/**
 * The transports offered in the "Reached via" select. Phone stays hidden until
 * the project has a Twilio provider in Settings > Model Providers, but an agent
 * already configured as phone still lists it so its own transport renders (the
 * gate is on the OPTION, not on an existing target).
 */
function visibleTransportsFor({
  hasTwilioKey,
  transport,
}: {
  hasTwilioKey: boolean;
  transport: VoiceTransport;
}): readonly VoiceTransport[] {
  return VOICE_TRANSPORTS.filter(
    (t) => t !== "phone" || hasTwilioKey || transport === "phone",
  );
}

function VoiceAgentForm({
  name,
  setName,
  transport,
  setTransport,
  voiceAgentId,
  setVoiceAgentId,
  phoneNumber,
  setPhoneNumber,
  hasTwilioKey,
  hasElevenLabsKey,
  hasAttemptedSubmit,
}: {
  name: string;
  setName: (value: string) => void;
  transport: VoiceTransport;
  setTransport: (value: VoiceTransport) => void;
  voiceAgentId: string;
  setVoiceAgentId: (value: string) => void;
  phoneNumber: string;
  setPhoneNumber: (value: string) => void;
  hasTwilioKey: boolean;
  hasElevenLabsKey: boolean;
  hasAttemptedSubmit: boolean;
}) {
  const nameInvalid = hasAttemptedSubmit && name.trim().length === 0;
  const voiceAgentIdInvalid =
    hasAttemptedSubmit && voiceAgentId.trim().length === 0;
  const phoneNumberInvalid =
    hasAttemptedSubmit && !E164_PHONE_PATTERN.test(phoneNumber.trim());
  const isPhone = transport === "phone";
  const visibleTransports = visibleTransportsFor({
    hasTwilioKey,
    transport,
  });
  const transportOptionsDisabled = visibleTransports.length <= 1;
  return (
    <VStack
      gap={4}
      align="stretch"
      flex={1}
      overflowY="auto"
      paddingX={6}
      paddingY={4}
    >
      <Field.Root required invalid={nameInvalid}>
        <Field.Label>Name</Field.Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter agent name"
          data-testid="voice-agent-name-input"
        />
        {nameInvalid && <Field.ErrorText>Name is required</Field.ErrorText>}
      </Field.Root>

      <Field.Root>
        <Field.Label>Reached via</Field.Label>
        <NativeSelect.Root disabled={transportOptionsDisabled}>
          <NativeSelect.Field
            value={transport}
            onChange={(e) => setTransport(e.target.value as VoiceTransport)}
            data-testid="voice-agent-transport-select"
          >
            {visibleTransports.map((t) => (
              <option key={t} value={t}>
                {VOICE_TRANSPORT_LABELS[t]}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        {!hasTwilioKey && !isPhone && (
          <Field.HelperText data-testid="voice-agent-phone-hint">
            To reach an agent by phone, add Twilio in Settings &gt; Model
            Providers.
          </Field.HelperText>
        )}
      </Field.Root>

      {isPhone ? (
        <PhoneNumberField
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          invalid={phoneNumberInvalid}
        />
      ) : (
        <ElevenLabsAgentIdField
          voiceAgentId={voiceAgentId}
          setVoiceAgentId={setVoiceAgentId}
          invalid={voiceAgentIdInvalid}
          hasElevenLabsKey={hasElevenLabsKey}
        />
      )}
    </VStack>
  );
}

/** The phone target's E.164 number, the whole identity of a phone target. */
function PhoneNumberField({
  phoneNumber,
  setPhoneNumber,
  invalid,
}: {
  phoneNumber: string;
  setPhoneNumber: (value: string) => void;
  invalid: boolean;
}) {
  return (
    <Field.Root required invalid={invalid}>
      <Field.Label>Phone number</Field.Label>
      <Input
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
        placeholder="+14155550123"
        data-testid="voice-agent-phone-input"
      />
      <Field.HelperText>
        In E.164 form: a plus sign, the country code, then the number.
      </Field.HelperText>
      {invalid && (
        <Field.ErrorText>
          Enter the number in E.164 form, like +14155550123
        </Field.ErrorText>
      )}
    </Field.Root>
  );
}

/** The ElevenLabs agent id, with the provider-key line beneath it. */
function ElevenLabsAgentIdField({
  voiceAgentId,
  setVoiceAgentId,
  invalid,
  hasElevenLabsKey,
}: {
  voiceAgentId: string;
  setVoiceAgentId: (value: string) => void;
  invalid: boolean;
  hasElevenLabsKey: boolean;
}) {
  return (
    <>
      <Field.Root required invalid={invalid}>
        <Field.Label>Agent id</Field.Label>
        <Input
          value={voiceAgentId}
          onChange={(e) => setVoiceAgentId(e.target.value)}
          placeholder="agent_..."
          data-testid="voice-agent-id-input"
        />
        <Field.HelperText>
          From the ElevenLabs dashboard: Agents, your agent, Agent ID
        </Field.HelperText>
        {invalid && <Field.ErrorText>Agent id is required</Field.ErrorText>}
      </Field.Root>

      <CredentialsLine hasElevenLabsKey={hasElevenLabsKey} />
    </>
  );
}

/** The credentials line: the key lives on the ElevenLabs provider row. */
function CredentialsLine({ hasElevenLabsKey }: { hasElevenLabsKey: boolean }) {
  if (hasElevenLabsKey) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Using the ElevenLabs provider key
      </Text>
    );
  }
  return (
    <HStack gap={2} fontSize="sm" color="fg.muted">
      <Text>No ElevenLabs key in this project</Text>
      <Link
        href={addKeyHref()}
        color="blue.fg"
        data-testid="voice-agent-add-key"
      >
        Add key
      </Link>
    </HStack>
  );
}

function VoiceAgentFooter({
  agentId,
  createdAgentRowId,
  transport,
  voiceAgentId,
  hasElevenLabsKey,
  isSaving,
  onCancel,
  onTalk,
  onSave,
}: {
  agentId: string | undefined;
  createdAgentRowId: string | undefined;
  transport: VoiceTransport;
  voiceAgentId: string;
  hasElevenLabsKey: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onTalk: () => void;
  onSave: () => void;
}) {
  // Once "Talk to it" has created the row, further saves update it: the
  // panel's created id stands in for the editor's own agentId (#20).
  const savedAgentId = agentId ?? createdAgentRowId;
  // Talk to it is enabled as soon as the transport's agent id is filled and the
  // project has a key, no save-first. The tooltip names whichever is missing.
  // Phone has no browser call, so it is always off with an explaining tooltip.
  const canTalk =
    transport !== "phone" && voiceAgentId.trim().length > 0 && hasElevenLabsKey;
  const talkTooltip = talkTooltipFor({
    transport,
    voiceAgentId,
    hasElevenLabsKey,
  });
  return (
    <Drawer.Footer borderTopWidth="1px" borderColor="border">
      <HStack gap={3}>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {/* No `disabled` prop here: Tooltip already no-ops on empty content, and
            toggling `disabled` would swap it between returning `children` bare and
            wrapping them in ChakraTooltip.Root, remounting the Button underneath. */}
        <Tooltip content={talkTooltip ?? ""} positioning={{ placement: "top" }}>
          <Box>
            <Button
              variant="outline"
              disabled={!canTalk}
              title={talkTooltip}
              onClick={onTalk}
              data-testid="voice-agent-talk"
            >
              Talk to it
            </Button>
          </Box>
        </Tooltip>
        <Button
          colorPalette="blue"
          onClick={onSave}
          disabled={isSaving}
          loading={isSaving}
          data-testid="save-agent-button"
        >
          {savedAgentId ? "Save Changes" : "Create Agent"}
        </Button>
      </HStack>
    </Drawer.Footer>
  );
}
