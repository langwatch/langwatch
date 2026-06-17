import {
  Field,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
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
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
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

export function NewVersionFields({
  canSaveOverride,
}: {
  canSaveOverride?: boolean;
} = {}) {
  const form = useFormContext<{ version: string; commitMessage: string }>();
  const { project } = useOrganizationTeamProject();
  const { checkCanCommitNewVersion, getWorkflow } = useWorkflowStore(
    ({ checkCanCommitNewVersion, getWorkflow }) => ({
      checkCanCommitNewVersion,
      getWorkflow,
    }),
  );
  const canSave = canSaveOverride ?? checkCanCommitNewVersion();

  const { previousVersion, nextVersion } = useVersionState({
    project,
    form,
  });

  // Cascade-resolved Fast model for commit-message autogen: null when
  // nothing is configured at any scope, so the doomed generation call
  // (and the missing-model toast it would surface) never auto-fires.
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "workflows.commit_message" },
    { enabled: !!project?.id },
  );

  const defaultModel = resolvedDefault.data?.model ?? "";
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    defaultModel,
    "chat",
  );
  const isDefaultModelDisabled = modelOption?.isDisabled ?? false;
  const isModelConfigured =
    resolvedDefault.data != null && !isDefaultModelDisabled;

  const generateCommitMessage =
    api.workflow.generateCommitMessage.useMutation();

  const userEditedCommitMessage = useRef(false);
  const hasTriggeredGeneration = useRef(false);

  const generateCommitMessageCallback = useCallback(
    (prevDsl: Workflow, newDsl: Workflow, options?: { force?: boolean }) => {
      // The explicit sparkles click forces through: failing there is
      // user-initiated, and the missing-model toast is the answer.
      if (!isModelConfigured && !options?.force) {
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
          // No onError toast: autogen only prefills the description
          // field, the user types one either way when it stays empty.
        },
      );
    },
    [form, generateCommitMessage, project?.id, isModelConfigured],
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
      // Hold the one-shot trigger until the model resolution answers,
      // so a slow query doesn't read as "not configured".
      if (!resolvedDefault.isFetched) return;
      hasTriggeredGeneration.current = true;
      userEditedCommitMessage.current = false;
      // No shouldValidate here: with no model to auto-fill the field,
      // validating the freshly-cleared value paints the required ring
      // before the user has done anything. Submit still validates.
      form.setValue("commitMessage", "", {
        shouldDirty: true,
      });
      if (isModelConfigured) {
        setTimeout(() => {
          debouncedGenerateCommitMessage(previousVersion.dsl!, getWorkflow());
        }, 0);
      }
    } else if (canSave && !previousVersion) {
      form.setValue("commitMessage", "First version", {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canSave,
    previousVersion?.dsl,
    resolvedDefault.isFetched,
    isModelConfigured,
  ]);

  // Only redden the fields once the user has actually attempted to submit.
  // The description is required and starts empty, so keying the ring on the
  // error alone paints it red the moment the dialog opens, before anyone has
  // typed anything.
  const shouldShowValidation = form.formState.submitCount > 0;

  return (
    <HStack width="full">
      <Field.Root
        width="fit-content"
        invalid={shouldShowValidation && !!form.formState.errors.version}
      >
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
      <Field.Root
        width="full"
        invalid={shouldShowValidation && !!form.formState.errors.commitMessage}
      >
        <VStack align="start" width="full">
          <Field.Label as={SmallLabel} color="fg.muted">
            Description
          </Field.Label>
          <InputGroup
            width="full"
            endElement={
              generateCommitMessage.isLoading ? (
                <AISparklesLoader />
              ) : canSave &&
                resolvedDefault.isFetched &&
                previousVersion?.dsl ? (
                // Always offer an explicit generate affordance: a manual retry
                // after a failed autogen, a re-roll of a description the user
                // does not like, or (with no model configured) the trigger that
                // surfaces the missing-model toast on purpose. force:true
                // bypasses the auto-gen gate; clearing the edited flag lets the
                // result land even if the user typed something first.
                <IconButton
                  size="xs"
                  variant="ghost"
                  color="blue.400"
                  aria-label="Generate description"
                  data-testid="generate-commit-message-button"
                  onClick={() => {
                    userEditedCommitMessage.current = false;
                    generateCommitMessageCallback(
                      previousVersion.dsl!,
                      getWorkflow(),
                      { force: true },
                    );
                  }}
                >
                  <Sparkles size={16} />
                </IconButton>
              ) : undefined
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
