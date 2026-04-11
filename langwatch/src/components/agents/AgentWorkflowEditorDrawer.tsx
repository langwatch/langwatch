import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Link as ChakraLink,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuArrowLeft, LuExternalLink } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import {
  ScenarioInputMappingSection,
  isScenarioMappingValid,
} from "~/components/suites/ScenarioInputMappingSection";
import type {
  FieldMapping,
  Variable,
} from "~/components/variables";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getInputsOutputs } from "~/optimization_studio/utils/nodeUtils";
import type {
  CustomComponentConfig,
  Field as DSLField,
  Workflow,
} from "~/optimization_studio/types/dsl";
import type {
  AgentComponentConfig,
  TypedAgent,
} from "~/server/agents/agent.repository";
import { computeBestMatchMappings } from "~/server/scenarios/execution/resolve-field-mappings";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

export type AgentWorkflowEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: TypedAgent) => void;
  /** If provided, loads an existing workflow agent for editing. */
  agentId?: string;
};

/** Narrow the stored agent config into a CustomComponentConfig. */
function getWorkflowConfig(config: AgentComponentConfig): CustomComponentConfig {
  return config as CustomComponentConfig;
}

/**
 * Extract entry inputs and end outputs from a workflow's published DSL.
 *
 * `getInputsOutputs` returns loose shapes because the DSL is stored as opaque
 * JSON. We narrow them into `Variable` (the shape expected by
 * `ScenarioInputMappingSection`). Workflow DSL fields are always string-typed
 * in practice, and the scenario section only needs the identifier to build
 * its rows, so we coerce unknown field types to `"str"`.
 */
function extractVariables(dsl: Workflow | undefined): {
  inputs: Variable[];
  outputs: Variable[];
} {
  if (!dsl) return { inputs: [], outputs: [] };
  const { inputs, outputs } = getInputsOutputs(dsl.edges, dsl.nodes);
  const normalizedInputs: Variable[] = (inputs ?? []).flatMap((i) =>
    typeof i.identifier === "string"
      ? [
          {
            identifier: i.identifier,
            type: "str" as DSLField["type"],
          },
        ]
      : [],
  );
  const rawOutputs = Array.isArray(outputs) ? outputs : [];
  const normalizedOutputs: Variable[] = rawOutputs.flatMap(
    (o: unknown): Variable[] => {
      if (typeof o !== "object" || o === null) return [];
      const field = o as { identifier?: unknown };
      if (typeof field.identifier !== "string") return [];
      return [
        {
          identifier: field.identifier,
          type: "str" as DSLField["type"],
        },
      ];
    },
  );
  return { inputs: normalizedInputs, outputs: normalizedOutputs };
}

/**
 * Drawer for editing a workflow-based agent's scenario integration.
 *
 * Workflow agents are authored in the optimization studio — this drawer only
 * edits the *agent wrapper*: its name, the linked workflow, and how scenario
 * data maps into the workflow's entry/end nodes. Use WorkflowSelectorDrawer to
 * create new workflow agents.
 */
export function AgentWorkflowEditorDrawer(
  props: AgentWorkflowEditorDrawerProps,
) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const drawerParams = useDrawerParams();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave = props.onSave;
  const agentId = props.agentId ?? drawerParams.agentId;
  const isOpen = props.open !== false && props.open !== undefined;

  // Form state
  const [name, setName] = useState("");
  const [scenarioMappings, setScenarioMappings] = useState<
    Record<string, FieldMapping>
  >({});
  const [scenarioOutputField, setScenarioOutputField] = useState<
    string | undefined
  >(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load existing agent
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentId && !!project?.id && isOpen },
  );

  // Derive linked workflowId from the agent (falling back to the DSL field).
  const workflowId = useMemo(() => {
    if (!agentQuery.data) return undefined;
    const fromAgent = (
      agentQuery.data as TypedAgent & { workflowId?: string | null }
    ).workflowId;
    if (fromAgent) return fromAgent;
    const fromConfig = getWorkflowConfig(agentQuery.data.config).workflow_id;
    return fromConfig;
  }, [agentQuery.data]);

  // Fetch the linked workflow so we can derive its real inputs/outputs.
  const workflowQuery = api.workflow.getById.useQuery(
    { projectId: project?.id ?? "", workflowId: workflowId ?? "" },
    { enabled: !!workflowId && !!project?.id && isOpen },
  );

  const { inputs: workflowInputs, outputs: workflowOutputs } = useMemo(
    () =>
      extractVariables(
        (workflowQuery.data?.currentVersion?.dsl as Workflow | undefined) ??
          undefined,
      ),
    [workflowQuery.data],
  );

  // Initialize form fields from the loaded agent.
  useEffect(() => {
    if (agentQuery.data) {
      setName(agentQuery.data.name);
      const config = getWorkflowConfig(agentQuery.data.config);
      const existingMappings = config.scenarioMappings ?? {};
      // If no saved mappings yet, compute best-match defaults from workflow
      // input names once the workflow has loaded.
      const effectiveInputs =
        workflowInputs.length > 0
          ? workflowInputs
          : [{ identifier: "input", type: "str" }];
      const mappings =
        Object.keys(existingMappings).length > 0
          ? existingMappings
          : computeBestMatchMappings({ inputs: effectiveInputs });
      setScenarioMappings(mappings);
      setScenarioOutputField(config.scenarioOutputField);
      setHasUnsavedChanges(false);
    }
  }, [agentQuery.data, workflowInputs]);

  // Mutations
  const updateMutation = api.agents.update.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.agents.getById.invalidate({
        id: agent.id,
        projectId: project?.id ?? "",
      });
      onSave?.(agent);
      onClose();
    },
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error updating agent",
        description: error.message,
        type: "error",
      });
    },
  });

  const isSaving = updateMutation.isPending;

  const isValid =
    name.trim().length > 0 &&
    workflowInputs.length > 0 &&
    workflowOutputs.length > 0 &&
    isScenarioMappingValid({
      mappings: scenarioMappings,
      outputs: workflowOutputs,
      outputField: scenarioOutputField,
    });

  const handleSave = useCallback(() => {
    if (!project?.id || !agentId || !isValid || !agentQuery.data) return;
    const existingConfig = getWorkflowConfig(agentQuery.data.config);
    const config: CustomComponentConfig = {
      ...existingConfig,
      name: name.trim(),
      scenarioMappings:
        Object.keys(scenarioMappings).length > 0 ? scenarioMappings : undefined,
      scenarioOutputField,
    };
    updateMutation.mutate({
      id: agentId,
      projectId: project.id,
      name: name.trim(),
      config,
    });
  }, [
    project?.id,
    agentId,
    name,
    scenarioMappings,
    scenarioOutputField,
    isValid,
    agentQuery.data,
    updateMutation,
  ]);

  const handleNameChange = (value: string) => {
    setName(value);
    setHasUnsavedChanges(true);
  };

  const handleScenarioMappingChange = useCallback(
    (identifier: string, mapping: FieldMapping | undefined) => {
      setScenarioMappings((prev) => {
        if (!mapping) {
          const next = { ...prev };
          delete next[identifier];
          return next;
        }
        return { ...prev, [identifier]: mapping };
      });
      setHasUnsavedChanges(true);
    },
    [],
  );

  const handleScenarioOutputFieldChange = useCallback(
    (field: string | undefined) => {
      setScenarioOutputField(field);
      setHasUnsavedChanges(true);
    },
    [],
  );

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          "You have unsaved changes. Are you sure you want to close?",
        )
      ) {
        return;
      }
    }
    onClose();
  };

  // Scenario inputs mirror the backend's fallback — if the workflow has no
  // entry inputs yet, the section renders an implicit `input` row so users
  // can still see the mapping UI.
  const scenarioInputsForUI: Variable[] =
    workflowInputs.length > 0
      ? workflowInputs
      : [{ identifier: "input", type: "str" }];

  const editorHref =
    project && workflowId ? `/${project.slug}/studio/${workflowId}` : undefined;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
      closeOnInteractOutside={false}
      modal={false}
      preventScroll={false}
    >
      <Drawer.Content>
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
            <Heading>Edit Workflow Agent</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          {agentId && (agentQuery.isLoading || workflowQuery.isLoading) ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <VStack
              gap={4}
              align="stretch"
              flex={1}
              paddingX={6}
              paddingY={4}
              overflowY="auto"
            >
              {/* Name */}
              <Field.Root required>
                <Field.Label>Agent Name</Field.Label>
                <Input
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Enter agent name"
                  data-testid="agent-name-input"
                />
              </Field.Root>

              {/* Linked workflow */}
              <Box>
                <Field.Root>
                  <Field.Label>Linked Workflow</Field.Label>
                  <HStack
                    gap={2}
                    paddingX={3}
                    paddingY={2}
                    borderWidth="1px"
                    borderColor="border"
                    borderRadius="md"
                    align="center"
                  >
                    <Text fontSize="sm" flex={1}>
                      {workflowQuery.data?.name ?? "(workflow not found)"}
                    </Text>
                    {editorHref && (
                      <ChakraLink
                        asChild
                        fontSize="sm"
                        color="blue.fg"
                        data-testid="open-workflow-editor-link"
                      >
                        <NextLink href={editorHref} target="_blank">
                          <HStack gap={1} align="center">
                            <Text>Open editor</Text>
                            <LuExternalLink size={14} />
                          </HStack>
                        </NextLink>
                      </ChakraLink>
                    )}
                  </HStack>
                  <Text fontSize="xs" color="fg.muted" marginTop={1}>
                    Edit the workflow&apos;s nodes and logic in the studio. The
                    mappings below control how scenario data flows into its
                    entry inputs and which end output is returned.
                  </Text>
                </Field.Root>
              </Box>

              {workflowInputs.length === 0 && (
                <Text fontSize="xs" color="fg.error">
                  This workflow has no entry inputs yet. Publish a version with
                  at least one entry input before running it as a scenario
                  target.
                </Text>
              )}

              {workflowOutputs.length === 0 && (
                <Text fontSize="xs" color="fg.error">
                  This workflow has no end outputs yet. Publish a version with
                  at least one end output before running it as a scenario
                  target.
                </Text>
              )}

              {/* Scenario Input/Output Mapping */}
              <Box>
                <ScenarioInputMappingSection
                  inputs={scenarioInputsForUI}
                  mappings={scenarioMappings}
                  onMappingChange={handleScenarioMappingChange}
                  outputs={workflowOutputs}
                  outputField={scenarioOutputField}
                  onOutputFieldChange={handleScenarioOutputFieldChange}
                />
              </Box>
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-agent-button"
            >
              Save Changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
