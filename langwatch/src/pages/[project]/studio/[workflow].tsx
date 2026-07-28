import { Alert, Box } from "@chakra-ui/react";
import { useEffect } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { HandledErrorAlert } from "~/features/errors";
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

  const queryClient = api.useContext();
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

  // A workflow that isn't there is a thing we can name, and the person looking
  // at it needs a way out. This used to be a bare full-screen "404 / An error
  // occurred" with no navigation and no explanation, while the query underneath
  // it held a perfectly good `workflow_not_found`. Rendered inside
  // `DashboardLayout` for the same reason the experiments page does it: the
  // sidebar is the way back.
  if (workflow.isError || (workflow.isFetched && !workflow.data)) {
    return (
      <DashboardLayout>
        <Box padding={6}>
          {workflow.error ? (
            <HandledErrorAlert
              error={workflow.error}
              fallbackTitle="Couldn't open this workflow"
            />
          ) : (
            <Alert.Root status="warning">
              <Alert.Indicator />
              <Alert.Title>Workflow not found</Alert.Title>
              <Alert.Description>
                It may have been deleted, or you may not have access to it.
              </Alert.Description>
            </Alert.Root>
          )}
        </Box>
      </DashboardLayout>
    );
  }

  return <OptimizationStudio />;
}
