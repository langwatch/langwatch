import { Button, useDisclosure, type ButtonProps } from "@chakra-ui/react";
import { Lock, Plus } from "lucide-react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { NewWorkflowModal } from "../../optimization_studio/components/workflow/NewWorkflowModal";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";

export const CreateWorkflowButton = ({ props }: { props?: ButtonProps }) => {
  const { project, isOrganizationFeatureEnabled, organization, hasPermission } =
    useOrganizationTeamProject();

  const hasWorkflowsCreatePermission = hasPermission("workflows:create");

  const { open, onClose, onOpen } = useDisclosure();

  const workflows = api.workflow.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  const canCreateWorkflow =
    (!!usage.data?.activePlan.maxWorkflows &&
      (workflows.data?.length ?? 0) < usage.data.activePlan.maxWorkflows) ||
    isOrganizationFeatureEnabled("OPTIMIZATION_STUDIO");

  if (!canCreateWorkflow) {
    return (
      <Tooltip content="You reached the limit of max workflows, click to upgrade your plan to add more workflows">
        <Button
          asChild
          variant="outline"
          size="sm"
          colorPalette="gray"
          opacity={0.6}
        >
          <Link
            href="/settings/subscription"
            onClick={() => {
              trackEvent("subscription_hook_click", {
                project_id: project?.id,
                hook: "studio_workflow_limit_reached",
              });
            }}
          >
            <Lock size={14} />
            Create Workflow
          </Link>
        </Button>
      </Tooltip>
    );
  }

  if (!hasWorkflowsCreatePermission) {
    return (
      <Tooltip content="You need workflows:create permission to create workflows">
        <Button variant="outline" size="sm" colorPalette="gray" opacity={0.6} disabled>
          <Lock size={14} />
          Create Workflow
        </Button>
      </Tooltip>
    );
  }

  return (
    <>
      <Button
        data-testid="active-create-new-workflow-button"
        onClick={onOpen}
        size="sm"
        variant="outline"
        {...props}
      >
        <Plus size={16} />
        Create Workflow
      </Button>
      <NewWorkflowModal open={open} onClose={onClose} />
    </>
  );
};

