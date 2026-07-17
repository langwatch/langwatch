import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Link as ChakraLink,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { LuArrowLeft, LuExternalLink } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import {
  type AvailableSource,
  type FieldMapping,
  type Variable,
  VariablesSection,
} from "~/components/variables";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getMappingSurfaceInputs } from "~/optimization_studio/utils/nodeUtils";
import type { Field as DSLField, Workflow } from "~/optimization_studio/types/dsl";
import type { TypedAgent } from "~/server/agents/agent.repository";
import NextLink from "~/utils/compat/next-link";
import { api } from "~/utils/api";

export type AgentWorkflowTargetEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  /** The workflow-type agent this target references. */
  agentId?: string;
  /** Available sources for variable mapping (from Evaluations V3). */
  availableSources?: AvailableSource[];
  /** Current input mappings (from Evaluations V3). */
  inputMappings?: Record<string, FieldMapping>;
  /** Callback when a mapping changes (persists immediately, no separate save). */
  onInputMappingsChange?: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
};

/**
 * Derives the mapping-surface inputs (identifier + type) from a workflow's
 * entry node, the same extraction AgentWorkflowEditorDrawer uses for
 * scenario mapping. Falls back to a single generic "input" field when the
 * workflow has no declared entry outputs yet, matching the runtime's own
 * fallback (see workflowBuilder.ts / code-agent adapter).
 */
function extractWorkflowInputs(dsl: Workflow | undefined): Variable[] {
  if (!dsl) return [];
  const rawInputs = getMappingSurfaceInputs(dsl.edges, dsl.nodes);
  return rawInputs.flatMap((i) =>
    typeof i.identifier === "string"
      ? [{ identifier: i.identifier, type: "str" as DSLField["type"] }]
      : [],
  );
}

/**
 * Drawer for a workflow-type agent target in the Experiments Workbench.
 *
 * A workflow-type agent has no code of its own to edit inline — it's a
 * pointer to a Studio workflow, and a full graph editor can't be edited
 * meaningfully inside a narrow sidebar. So this drawer shows the linked
 * workflow as a card with a link to open the real editor in a new tab, and
 * below it, the mapping UI that every other agent target type already gets
 * (dataset columns -> the workflow's real input fields).
 */
export function AgentWorkflowTargetEditorDrawer(
  props: AgentWorkflowTargetEditorDrawerProps,
) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const flowCallbacks = getFlowCallbacks("agentWorkflowTargetEditor");

  const onClose = props.onClose ?? closeDrawer;
  const agentId =
    props.agentId ??
    drawerParams.agentId ??
    (complexProps.agentId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  const availableSources =
    props.availableSources ??
    (complexProps.availableSources as AvailableSource[] | undefined);
  const inputMappings =
    props.inputMappings ??
    (complexProps.inputMappings as Record<string, FieldMapping> | undefined);
  const onInputMappingsChange =
    props.onInputMappingsChange ?? flowCallbacks?.onInputMappingsChange;

  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentId && !!project?.id && isOpen },
  );

  const workflowId = useMemo(() => {
    if (!agentQuery.data) return undefined;
    const agent = agentQuery.data as TypedAgent & { workflowId?: string | null };
    if (agent.workflowId) return agent.workflowId;
    const config = agent.config as { workflow_id?: string };
    return config.workflow_id;
  }, [agentQuery.data]);

  const workflowQuery = api.workflow.getById.useQuery(
    { projectId: project?.id ?? "", workflowId: workflowId ?? "" },
    { enabled: !!workflowId && !!project?.id && isOpen },
  );

  const workflowInputs = useMemo(
    () =>
      extractWorkflowInputs(
        workflowQuery.data?.currentVersion?.dsl as Workflow | undefined,
      ),
    [workflowQuery.data],
  );

  const variablesForUI: Variable[] =
    workflowInputs.length > 0 ? workflowInputs : [{ identifier: "input", type: "str" }];

  const editorHref =
    project && workflowId ? `/${project.slug}/studio/${workflowId}` : undefined;

  const isLoading = !!agentId && (agentQuery.isLoading || workflowQuery.isLoading);

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
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
            <Heading>Workflow Agent</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          {isLoading ? (
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
              <Box>
                <Field.Root>
                  <Field.Label>Workflow</Field.Label>
                  <HStack
                    gap={2}
                    paddingX={3}
                    paddingY={2}
                    borderWidth="1px"
                    borderColor="border"
                    borderRadius="md"
                    align="center"
                  >
                    <Text fontSize="sm" flex={1} data-testid="linked-workflow-name">
                      {workflowQuery.data?.name ?? "(workflow not found)"}
                    </Text>
                    {editorHref && (
                      <ChakraLink
                        asChild
                        fontSize="sm"
                        color="blue.fg"
                        data-testid="open-workflow-link"
                      >
                        <NextLink href={editorHref} target="_blank">
                          <HStack gap={1} align="center">
                            <Text>Open Workflow</Text>
                            <LuExternalLink size={14} />
                          </HStack>
                        </NextLink>
                      </ChakraLink>
                    )}
                  </HStack>
                </Field.Root>
              </Box>

              <VariablesSection
                title="Input Variables"
                variables={variablesForUI}
                onChange={() => {
                  // The variable list comes from the workflow's own entry
                  // node — not user-editable here, only mappable.
                }}
                showMappings={true}
                availableSources={availableSources}
                mappings={inputMappings}
                onMappingChange={onInputMappingsChange}
                canAddRemove={false}
                readOnly={false}
              />
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button onClick={onClose} data-testid="close-drawer-button">
            Close
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
