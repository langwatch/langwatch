import {
  Box,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Tooltip,
  useDisclosure,
  VStack,
  useToast,
} from "@chakra-ui/react";

import { useCallback } from "react";
import { CheckSquare } from "react-feather";
import { useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { NewVersionFields, useVersionState } from "./History";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { api } from "../../utils/api";
import { useEvaluationExecution } from "../hooks/useEvaluationExecution";

export function Evaluate() {
  const { isOpen, onToggle, onClose } = useDisclosure();

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={onToggle}
        leftIcon={<CheckSquare size={16} />}
      >
        Evaluate
      </Button>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <EvaluateModalContent onClose={onClose} />
      </Modal>
    </>
  );
}

export function EvaluateModalContent({ onClose }: { onClose: () => void }) {
  const { project } = useOrganizationTeamProject();
  const { workflowId, getWorkflow } = useWorkflowStore(
    ({ workflowId, getWorkflow }) => ({
      workflowId,
      getWorkflow,
    })
  );
  const form = useForm<{ version: string; commitMessage: string }>({
    defaultValues: {
      version: "",
      commitMessage: "",
    },
  });

  const { canSaveNewVersion, nextVersion } = useVersionState({
    project,
    form,
    allowSaveIfAutoSaveIsCurrentButNotLatest: false,
  });

  const toast = useToast();
  const commitVersion = api.workflow.commitVersion.useMutation();
  const { startEvaluationExecution } = useEvaluationExecution();

  const onSubmit = useCallback(
    async ({
      version,
      commitMessage,
    }: {
      version: string;
      commitMessage: string;
    }) => {
      if (!project || !workflowId) return;

      if (canSaveNewVersion) {
        try {
          await commitVersion.mutateAsync({
            projectId: project.id,
            workflowId,
            commitMessage,
            dsl: {
              ...getWorkflow(),
              version,
            },
          });
        } catch (error) {
          toast({
            title: "Error saving version",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          throw error;
        }
      }

      startEvaluationExecution();
    },
    [canSaveNewVersion]
  );

  return (
    <ModalContent
      as="form"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <ModalHeader fontWeight={600}>Evaluate Workflow</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <VStack align="start" width="full">
          <NewVersionFields
            form={form}
            nextVersion={nextVersion}
            canSaveNewVersion={canSaveNewVersion}
          />
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="outline"
          type="submit"
          alignSelf="end"
          isDisabled={!canSaveNewVersion}
          leftIcon={<CheckSquare size={16} />}
        >
          {canSaveNewVersion ? "Save & Run Evaluation" : "Run Evaluation"}
        </Button>
      </ModalFooter>
    </ModalContent>
  );
}
