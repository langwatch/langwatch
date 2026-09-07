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
  VOICE_TRANSPORT_LABELS,
  VOICE_TRANSPORTS,
  type VoiceTransport,
} from "~/server/agents/voice/voice-agent.config";
import { api } from "~/utils/api";
import { TalkToItPanel } from "./voice/TalkToItPanel";

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
};

const draftKey = (projectId: string) => `voice-agent-draft:${projectId}`;

function readDraft(projectId: string): VoiceAgentDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VoiceAgentDraft>;
    if (typeof parsed.agentId !== "string" || typeof parsed.name !== "string") {
      return null;
    }
    const transport = VOICE_TRANSPORTS.includes(
      parsed.transport as VoiceTransport,
    )
      ? (parsed.transport as VoiceTransport)
      : DEFAULT_TRANSPORT;
    return { name: parsed.name, transport, agentId: parsed.agentId };
  } catch {
    return null;
  }
}

function writeDraft(projectId: string, draft: VoiceAgentDraft): void {
  try {
    sessionStorage.setItem(draftKey(projectId), JSON.stringify(draft));
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
// Main Component
// ============================================================================

/**
 * Drawer for creating/editing a voice agent.
 *
 * Mirrors {@link AgentHttpEditorDrawer}: same onSave resolution, the same
 * create/update mutations, and the same flow-callback forwarding so the run
 * dialog and the scenario editor can open it and be told about the saved
 * agent. The credential comes from the project's ElevenLabs provider row — the
 * agent stores no secret — so the drawer only says whether that key is present.
 */
export function AgentVoiceEditorDrawer(props: AgentVoiceEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const flowCallbacksForSave = getFlowCallbacks("agentVoiceEditor");
  const utils = api.useUtils();

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
  const isCreating = !agentId;
  const projectId = project?.id ?? "";

  // Form state
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<VoiceTransport>(DEFAULT_TRANSPORT);
  const [voiceAgentId, setVoiceAgentId] = useState("");

  // Talk-to-it panel state. The agent need not be saved first: the call mints
  // from the form values, and the row is created on hang-up if it has none yet.
  const [talkOpen, setTalkOpen] = useState(false);
  const [createdAgentRowId, setCreatedAgentRowId] = useState<
    string | undefined
  >(undefined);

  // Load existing agent when editing.
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId },
    { enabled: !!agentId && !!projectId && isOpen },
  );

  // Whether the project has an ElevenLabs key that can sign a session. The key
  // value is never fetched — only whether an enabled ElevenLabs provider row
  // carries one.
  const providersQuery =
    api.modelProvider.listAllForProjectForFrontend.useQuery(
      { projectId },
      { enabled: !!projectId && isOpen },
    );
  const hasElevenLabsKey = (providersQuery.data?.providers ?? []).some(
    (row) =>
      row.provider === "elevenlabs" &&
      row.enabled &&
      (row.isSystem ||
        Boolean(
          (row.customKeys as Record<string, unknown> | null | undefined)
            ?.ELEVENLABS_API_KEY,
        )),
  );

  const formInitializedRef = useRef(false);
  const lastAgentIdRef = useRef<string | undefined>(undefined);

  // Initialize the form once per drawer session: the saved agent when editing,
  // the sessionStorage draft (else empty) when creating.
  useEffect(() => {
    if (lastAgentIdRef.current !== agentId) {
      formInitializedRef.current = false;
      lastAgentIdRef.current = agentId;
    }
    if (formInitializedRef.current) return;

    if (agentQuery.data) {
      const config = agentQuery.data.config as {
        transport?: VoiceTransport;
        agentId?: string;
      };
      setName(agentQuery.data.name ?? "");
      setTransport(config.transport ?? DEFAULT_TRANSPORT);
      setVoiceAgentId(config.agentId ?? "");
      formInitializedRef.current = true;
    } else if (isCreating && isOpen && projectId) {
      const draft = readDraft(projectId);
      setName(draft?.name ?? "");
      setTransport(draft?.transport ?? DEFAULT_TRANSPORT);
      setVoiceAgentId(draft?.agentId ?? "");
      formInitializedRef.current = true;
    }
  }, [agentQuery.data, agentId, isCreating, isOpen, projectId]);

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
    writeDraft(projectId, { name, transport, agentId: voiceAgentId });
  }, [isCreating, isOpen, projectId, name, transport, voiceAgentId]);

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

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isValid = name.trim().length > 0 && voiceAgentId.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!projectId || !isValid) return;
    const config = { transport, agentId: voiceAgentId.trim() };
    if (agentId) {
      updateMutation.mutate({
        id: agentId,
        projectId,
        name: name.trim(),
        config,
      });
    } else {
      createMutation.mutate({
        projectId,
        name: name.trim(),
        type: "voice",
        config,
      });
    }
  }, [
    projectId,
    isValid,
    transport,
    voiceAgentId,
    agentId,
    name,
    createMutation,
    updateMutation,
  ]);

  const handleClose = useCallback(() => {
    if (projectId) clearDraft(projectId);
    onClose();
  }, [projectId, onClose]);

  // The Add-key detour carries the current URL back so the provider page can
  // return here with the draft still in place.
  const addKeyHref = (() => {
    if (typeof window === "undefined") return MODEL_PROVIDERS_ROUTE;
    const returnTo = encodeURIComponent(window.location.href);
    return `${MODEL_PROVIDERS_ROUTE}?returnTo=${returnTo}`;
  })();

  // Talk to it is enabled as soon as the transport's agent id is filled and the
  // project has a key — no save-first. The tooltip names whichever is missing.
  const canTalk = voiceAgentId.trim().length > 0 && hasElevenLabsKey;
  const talkTooltip =
    voiceAgentId.trim().length === 0
      ? "Enter the agent id first"
      : !hasElevenLabsKey
        ? "Add an ElevenLabs key first"
        : undefined;

  const talkAgentRowId = agentId ?? createdAgentRowId;

  const transportOptionsDisabled = VOICE_TRANSPORTS.length <= 1;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
      closeOnInteractOutside={false}
      modal={false}
      preventScroll={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
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
            <Heading>
              {agentId ? "Edit Voice Agent" : "New Voice Agent"}
            </Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          {talkOpen ? (
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
                onClick={() => setTalkOpen(false)}
                data-testid="voice-agent-talk-back"
              >
                <LuArrowLeft size={16} /> Back
              </Button>
              <TalkToItPanel
                projectId={projectId}
                projectSlug={project?.slug ?? ""}
                transport={transport}
                agentId={voiceAgentId.trim()}
                agentRowId={talkAgentRowId}
                name={name.trim() || undefined}
                onAgentCreated={(rowId) => {
                  setCreatedAgentRowId(rowId);
                  void utils.agents.getAll.invalidate({ projectId });
                }}
              />
            </VStack>
          ) : agentId && agentQuery.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <VStack
              gap={4}
              align="stretch"
              flex={1}
              overflowY="auto"
              paddingX={6}
              paddingY={4}
            >
              <Field.Root required>
                <Field.Label>Name</Field.Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter agent name"
                  data-testid="voice-agent-name-input"
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>Reached via</Field.Label>
                <NativeSelect.Root disabled={transportOptionsDisabled}>
                  <NativeSelect.Field
                    value={transport}
                    onChange={(e) =>
                      setTransport(e.target.value as VoiceTransport)
                    }
                    data-testid="voice-agent-transport-select"
                  >
                    {VOICE_TRANSPORTS.map((t) => (
                      <option key={t} value={t}>
                        {VOICE_TRANSPORT_LABELS[t]}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>

              <Field.Root required>
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
              </Field.Root>

              {/* Credentials line — the key lives on the ElevenLabs provider
                  row, never on the agent. */}
              {hasElevenLabsKey ? (
                <Text fontSize="sm" color="fg.muted">
                  Using the ElevenLabs provider key
                </Text>
              ) : (
                <HStack gap={2} fontSize="sm" color="fg.muted">
                  <Text>No ElevenLabs key in this project</Text>
                  <Link
                    href={addKeyHref}
                    color="blue.fg"
                    data-testid="voice-agent-add-key"
                  >
                    Add key
                  </Link>
                </HStack>
              )}
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            {/* No `disabled` prop here: Tooltip already no-ops on empty
                content, and toggling `disabled` would swap it between
                returning `children` bare and wrapping them in
                ChakraTooltip.Root, remounting the Button underneath. */}
            <Tooltip
              content={talkTooltip ?? ""}
              positioning={{ placement: "top" }}
            >
              <Box>
                <Button
                  variant="outline"
                  disabled={!canTalk}
                  title={talkTooltip}
                  onClick={() => setTalkOpen(true)}
                  data-testid="voice-agent-talk"
                >
                  Talk to it
                </Button>
              </Box>
            </Tooltip>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-agent-button"
            >
              {agentId ? "Save Changes" : "Create Agent"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
