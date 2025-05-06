import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Check, X } from "react-feather";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";

import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useLoadWorkflow } from "../hooks/useLoadWorkflow";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { hasDSLChanged } from "../utils/dslUtils";

let saveTimeout: NodeJS.Timeout;

export function AutoSave() {
  const { project } = useOrganizationTeamProject();
  const { workflow } = useLoadWorkflow();
  const autosave = api.workflow.autosave.useMutation();
  const [recentlySaved, setRecentlySaved] = useState(false);

  const {
    setWorkflow,
    setPreviousWorkflow,
    hasPendingChanges,
    getWorkflow,
    getPreviousWorkflow,
  } = useWorkflowStore(
    ({
      setWorkflow,
      setPreviousWorkflow,
      hasPendingChanges,
      getWorkflow,
      getPreviousWorkflow,
    }) => ({
      setWorkflow,
      setPreviousWorkflow,
      hasPendingChanges,
      getWorkflow,
      getPreviousWorkflow,
    })
  );
  const stateWorkflow = useWorkflowStore(
    // Use shallow to compare equality of the workflow values only, since object is always re-created
    useShallow((state) => state.getWorkflow())
  );

  const trpc = api.useContext();

  const saveIfChanged = useDebouncedCallback(
    () => {
      if (!project || !workflow.data) return;

      const stateWorkflow = getWorkflow();
      if (hasPendingChanges()) {
        const previousWorkflow = getPreviousWorkflow()!;

        const setAsLatestVersion = hasDSLChanged(
          previousWorkflow,
          stateWorkflow,
          false
        );
        autosave.mutate(
          {
            projectId: project.id,
            workflowId: workflow.data.id,
            dsl: stateWorkflow,
            setAsLatestVersion,
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
              void (async () => {
                await trpc.workflow.getVersions.refetch({
                  workflowId: workflow.data.id,
                  projectId: project.id,
                  returnDSL: "previousVersion",
                });
                setPreviousWorkflow(stateWorkflow);
              })();
            },
          }
        );
      } else {
        setPreviousWorkflow(stateWorkflow);
      }
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

  return (
    <Box paddingLeft={2}>
      {autosave.isLoading ? (
        <HStack>
          <Spinner size="xs" />
          <Text fontSize="13px">Saving...</Text>
        </HStack>
      ) : autosave.isError ? (
        <HStack color="red.600">
          <X size={16} />
          <Text fontSize="13px">Failed to autosave</Text>
        </HStack>
      ) : recentlySaved ? (
        <HStack>
          <Box color="green.600">
            <Check width="16px" height="16px" />
          </Box>
          <Text fontSize="13px">Saved</Text>
        </HStack>
      ) : null}
    </Box>
  );
}
