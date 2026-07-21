import { Button, Field, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import {
  type AvailableSource,
  type FieldMapping,
  VariablesSection,
} from "~/components/variables";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { WorkflowCardDisplay } from "~/optimization_studio/components/workflow/WorkflowCard";
import { useWorkflowTargetAgentData } from "./useWorkflowTargetAgentData";

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

  const { workflowQuery, variablesForUI, editorHref, isLoading, hasLookupFailed } =
    useWorkflowTargetAgentData({
      agentId,
      projectId: project?.id,
      projectSlug: project?.slug,
      isOpen,
    });

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
              {workflowQuery.data && (
                <Field.Root>
                  <Field.Label>Workflow</Field.Label>
                  {editorHref ? (
                    // isExternal renders a plain anchor directly, not
                    // composed through the app router's client-side Link:
                    // target="_blank" is always a hard navigation into a
                    // new tab regardless, and composing through NextLink
                    // previously swallowed data-testid — Chakra's asChild
                    // slot only forwards style-related props to the
                    // composed child, not arbitrary data attributes.
                    <Link
                      href={editorHref}
                      isExternal
                      data-testid="open-workflow-link"
                    >
                      <WorkflowCardDisplay
                        name={workflowQuery.data.name}
                        icon={workflowQuery.data.icon}
                        updatedAt={workflowQuery.data.updatedAt}
                        action={
                          <ExternalLink
                            size={16}
                            color="var(--chakra-colors-fg-muted)"
                          />
                        }
                        width="300px"
                      />
                    </Link>
                  ) : (
                    <WorkflowCardDisplay
                      name={workflowQuery.data.name}
                      icon={workflowQuery.data.icon}
                      updatedAt={workflowQuery.data.updatedAt}
                      width="300px"
                    />
                  )}
                </Field.Root>
              )}

              {hasLookupFailed ? (
                <Text
                  fontSize="sm"
                  color="fg.error"
                  data-testid="workflow-lookup-error"
                >
                  Couldn't load this workflow's agent or its linked workflow,
                  so its real input fields aren't known. Mapping is
                  unavailable until it loads successfully.
                </Text>
              ) : (
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
              )}
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
