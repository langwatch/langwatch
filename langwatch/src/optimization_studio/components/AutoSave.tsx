import { Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useLoadWorkflow } from "../hooks/useLoadWorkflow";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { hasDSLChange } from "./History";

let saveTimeout: NodeJS.Timeout;

export function AutoSave() {
  const { project } = useOrganizationTeamProject();
  const { workflow } = useLoadWorkflow();
  const autosave = api.workflow.autosave.useMutation();
  const [recentlySaved, setRecentlySaved] = useState(false);

  const { setWorkflow, setPreviousWorkflow } = useWorkflowStore(
    ({ setWorkflow, setPreviousWorkflow }) => ({
      setWorkflow,
      setPreviousWorkflow,
    })
  );
  const stateWorkflow = useWorkflowStore(
    // Use shallow to compare equality of the workflow values only, since object is always re-created
    useShallow((state) => state.getWorkflow())
  );
  const previousWorkflow = useWorkflowStore(
    // Same here
    useShallow((state) => state.previousWorkflow)
  );
  const saveIfChanged = useDebouncedCallback(
    () => {
      if (!project || !workflow.data) return;

      if (previousWorkflow && hasDSLChange(previousWorkflow, stateWorkflow)) {
        autosave.mutate(
          {
            projectId: project.id,
            workflowId: workflow.data.id,
            dsl: stateWorkflow,
          },
          {
            onSuccess: (data) => {
              if (data.version !== stateWorkflow.version) {
                setWorkflow({ version: data.version });
              }
              setRecentlySaved(true);
              clearTimeout(saveTimeout);
              saveTimeout = setTimeout(() => {
                setRecentlySaved(false);
              }, 5000);
            },
          }
        );
      }
      setPreviousWorkflow(stateWorkflow);
    },
    1000,
    { leading: false, trailing: true, maxWait: 30_000 }
  );

  useEffect(() => {
    if (!workflow.data) return;

    setRecentlySaved(false);
    saveIfChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateWorkflow]);

  return autosave.isLoading ? (
    <Text fontSize={13}>Saving...</Text>
  ) : autosave.isError ? (
    <Text fontSize={13} color="red.600">
      Failed to autosave
    </Text>
  ) : recentlySaved ? (
    <Text fontSize={13}>Saved</Text>
  ) : null;
}
