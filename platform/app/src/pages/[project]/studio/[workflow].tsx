import { Button } from "@chakra-ui/react";
import { SearchX } from "lucide-react";
import { useEffect } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { Link } from "~/components/ui/link";
import { HandledErrorState } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import OptimizationStudio from "../../../optimization_studio/components/OptimizationStudio";
import { useLoadWorkflow } from "../../../optimization_studio/hooks/useLoadWorkflow";
import {
  _useWorkflowStore,
  useWorkflowStore,
} from "../../../optimization_studio/hooks/useWorkflowStore";
import type { Workflow } from "../../../optimization_studio/types/dsl";
import { api } from "../../../utils/api";

export default function Studio() {
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
      | Workflow
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
      <DashboardLayout>
        {/*
          `fullHeight` off: `DashboardLayout` already owns the viewport, so a
          second 100vh would push the state below the fold.
        */}
        <HandledErrorState
          error={workflow.error}
          fallbackTitle="Couldn't open this workflow"
          icon={<SearchX size={44} strokeWidth={1.5} />}
          fullHeight={false}
        >
          {project && (
            <Link href={`/${project.slug}/workflows`}>
              <Button colorPalette="orange">Back to workflows</Button>
            </Link>
          )}
        </HandledErrorState>
      </DashboardLayout>
    );
  }

  return <OptimizationStudio />;
}
