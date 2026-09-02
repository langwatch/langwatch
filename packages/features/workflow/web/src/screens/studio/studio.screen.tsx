import { Button } from "@chakra-ui/react";
import { SearchX } from "lucide-react";
import { useEffect } from "react";
import { Link } from "../../studio-host/link";
import { HandledErrorState } from "../../studio-host/errors";
import { useOrganizationTeamProject } from "../../studio-host/use-organization-team-project";
import OptimizationStudio from "../../optimization_studio/components/optimization-studio";
import { useLoadWorkflow } from "../../optimization_studio/hooks/use-load-workflow";
import { _useWorkflowStore, useWorkflowStore } from "@langwatch/workflow-web";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import { api } from "../../studio-host/api";
import { useStudioHostBinding } from "../../studio-host/binding";

export default function Studio() {
  useStudioHostBinding();
  const { workflow } = useLoadWorkflow();
  const { project } = useOrganizationTeamProject();

  const {
    reset,
    setWorkflow,
    setAutosavedWorkflow,
    setLastCommittedWorkflow,
    setCurrentVersionId,
  } = useWorkflowStore(
    ({
      reset,
      setWorkflow,
      setAutosavedWorkflow,
      setLastCommittedWorkflow,
      setCurrentVersionId,
    }) => ({
      reset,
      setWorkflow,
      setAutosavedWorkflow,
      setLastCommittedWorkflow,
      setCurrentVersionId,
    }),
  );
  const { clear } = _useWorkflowStore.temporal.getState();

  const queryClient = api.useUtils();
  useEffect(() => {
    // Invalidate the workflow once navigating away to make sure when comming back
    // that is doesn't accidentaly renders the previous version of the workflow
    return () => {
      void queryClient.workflow.getById.invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dsl = workflow.data?.currentVersion?.dsl as unknown as
      | StudioWorkflow
      | undefined;
    if (dsl) {
      // Prevent autosave from triggering after load
      setAutosavedWorkflow(undefined);
      setWorkflow({
        ...dsl,
        workflow_id: workflow.data?.id,
        nodes: (dsl.nodes ?? []).map((node: any) => ({
          ...node,
          selected: false,
        })),
      });
      setLastCommittedWorkflow(dsl);
      // Snapshot the normalized store state as autosave baseline so
      // hasPendingChanges() does not falsely detect dirty state after load
      const loadedWorkflow = _useWorkflowStore.getState().getWorkflow();
      setAutosavedWorkflow(loadedWorkflow);
      setCurrentVersionId(workflow.data?.currentVersion?.id);
    } else {
      reset();
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!workflow.data]);

  // A missing workflow is a thing we can name, and the person looking at it
  // needs a way out — this was a bare full-screen "404 / An error occurred"
  // with no navigation, while the query underneath held `workflow_not_found`.
  // Inside `DashboardLayout` for the same reason the experiments page does it:
  // the sidebar is the way back.
  //
  // On `isError` alone. The old condition also fired on "fetched but no data",
  // which only meant anything while a missing workflow came back as an empty
  // success; `getById` raises now. What that arm can still catch is a moment
  // mid-refetch where `data` is briefly undefined — flashing a dead end over a
  // studio someone is working in, which is worse than what it guarded.
  if (workflow.isError) {
    return (
      // `DashboardLayout` DID NOT TRAVEL: chrome belongs to the route tree, and
      // this address is served without a layout route above it — which is why
      // the studio draws its own full-viewport header. The dead end therefore
      // owns the viewport itself, and the way back is the button rather than a
      // sidebar that is not there.
      <HandledErrorState
        error={workflow.error}
        fallbackTitle="Couldn't open this workflow"
        icon={<SearchX size={44} strokeWidth={1.5} />}
      >
        {project && (
          <Link href={`/${project.slug}/workflows`}>
            <Button colorPalette="orange">Back to workflows</Button>
          </Link>
        )}
      </HandledErrorState>
    );
  }

  return <OptimizationStudio />;
}
