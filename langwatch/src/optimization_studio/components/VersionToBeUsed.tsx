import { Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";
import { useDebounceCallback } from "usehooks-ts";

import { AISparklesLoader } from "../../components/icons/AISparklesLoader";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "../../components/ModelSelector";
import { SmallLabel } from "../../components/SmallLabel";
import { InputGroup } from "../../components/ui/input-group";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { DEFAULT_MODEL } from "../../utils/constants";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Workflow } from "../types/dsl";
import { useVersionState } from "./History";

export const VersionToBeUsed = () => {
  const { checkCanCommitNewVersion } = useWorkflowStore(
    ({ checkCanCommitNewVersion }) => ({ checkCanCommitNewVersion }),
  );
  const canSave = checkCanCommitNewVersion();

  if (canSave) {
    return <NewVersionFields />;
  }

  return <CurrentVersionDisplay />;
};

function CurrentVersionDisplay() {
  const { project } = useOrganizationTeamProject();
  const { currentVersion } = useVersionState({ project });

  const display = currentVersion?.autoSaved
    ? {
        version: currentVersion?.parent?.version,
        commitMessage: currentVersion?.parent?.commitMessage,
      }
    : {
        version: currentVersion?.version,
        commitMessage: currentVersion?.commitMessage,
      };

  return (
    <HStack width="full">
      <VStack align="start">
        <SmallLabel color="fg.muted">Version</SmallLabel>
        <Text width="74px">{display.version}</Text>
      </VStack>
      <VStack align="start" width="full">
        <SmallLabel color="fg.muted">Description</SmallLabel>
        <Text>{display.commitMessage}</Text>
      </VStack>
    </HStack>
  );
}

export function NewVersionFields() {
  const form = useFormContext<{ version: string; commitMessage: string }>();
  const { project } = useOrganizationTeamProject();
  const { checkCanCommitNewVersion, getWorkflow } = useWorkflowStore(
    ({ checkCanCommitNewVersion, getWorkflow }) => ({
      checkCanCommitNewVersion,
      getWorkflow,
    }),
  );
  const canSave = checkCanCommitNewVersion();

  const { previousVersion, nextVersion } = useVersionState({
    project,
    form,
  });

  const defaultModel = project?.defaultModel ?? DEFAULT_MODEL;
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    defaultModel,
    "chat",
  );
  const isDefaultModelDisabled = modelOption?.isDisabled ?? false;

  const generateCommitMessage =
    api.workflow.generateCommitMessage.useMutation();

  const userEditedCommitMessage = useRef(false);
  const hasTriggeredGeneration = useRef(false);

  const generateCommitMessageCallback = useCallback(
    (prevDsl: Workflow, newDsl: Workflow) => {
      if (isDefaultModelDisabled) {
        return;
      }

      generateCommitMessage.mutate(
        {
          projectId: project?.id ?? "",
          prevDsl,
          newDsl,
        },
        {
          onSuccess: (data) => {
            if (data && !userEditedCommitMessage.current) {
              form.setValue("commitMessage", data as string, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }
          },
          onError: (e) => {
            toaster.create({
              title: "Error auto-generating version description",
              description: e.message,
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
          },
        },
      );
    },
    [form, generateCommitMessage, project?.id, isDefaultModelDisabled],
  );

  const debouncedGenerateCommitMessage = useDebounceCallback(
    (prevDsl: Workflow, newDsl: Workflow) => {
      generateCommitMessageCallback(prevDsl, newDsl);
    },
    500,
    { leading: true, trailing: false },
  );

  useEffect(() => {
    if (canSave && previousVersion?.dsl && !hasTriggeredGeneration.current) {
      hasTriggeredGeneration.current = true;
      userEditedCommitMessage.current = false;
      form.setValue("commitMessage", "", {
        shouldDirty: true,
        shouldValidate: true,
      });
      setTimeout(() => {
        debouncedGenerateCommitMessage(previousVersion.dsl!, getWorkflow());
      }, 0);
    } else if (canSave && !previousVersion) {
      form.setValue("commitMessage", "First version", {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave, previousVersion?.dsl]);

  return (
    <HStack width="full">
      <Field.Root width="fit-content" invalid={!!form.formState.errors.version}>
        <VStack align="start">
          <Field.Label as={SmallLabel} color="fg.muted">
            Version
          </Field.Label>
          <Input
            {...form.register("version", {
              required: true,
              pattern: /^\d+(\.\d+)?$/,
            })}
            placeholder={nextVersion}
            maxWidth="60px"
            pattern="\d+(\.\d+)?"
            readOnly
          />
        </VStack>
      </Field.Root>
      <Field.Root width="full" invalid={!!form.formState.errors.commitMessage}>
        <VStack align="start" width="full">
          <Field.Label as={SmallLabel} color="fg.muted">
            Description
          </Field.Label>
          <InputGroup
            width="full"
            endElement={
              generateCommitMessage.isLoading ? <AISparklesLoader /> : undefined
            }
          >
            <Input
              {...form.register("commitMessage", {
                required: true,
                onChange: () => {
                  userEditedCommitMessage.current = true;
                },
              })}
              placeholder={
                generateCommitMessage.isLoading
                  ? "Generating..."
                  : "What changes have you made?"
              }
              width="full"
              disabled={!canSave}
            />
          </InputGroup>
        </VStack>
      </Field.Root>
    </HStack>
  );
}
