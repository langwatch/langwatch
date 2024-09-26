import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Skeleton,
  SkeletonText,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, StopCircle, X } from "react-feather";
import { useForm, type UseFormReturn } from "react-hook-form";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useEvaluationExecution } from "../hooks/useEvaluationExecution";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { NewVersionFields, useVersionState } from "./History";

export function Evaluate() {
  const { isOpen, onToggle, onClose } = useDisclosure();

  const { evaluationState } = useWorkflowStore(({ state }) => ({
    evaluationState: state.evaluation,
  }));

  const isRunning = evaluationState?.status === "running";

  return (
    <>
      <Tooltip label={isRunning ? "Evaluation is running" : ""}>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggle}
          leftIcon={<CheckSquare size={16} />}
          isDisabled={isRunning}
        >
          Evaluate
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        {isOpen && <EvaluateModalContent onClose={onClose} />}
      </Modal>
    </>
  );
}

export function EvaluateModalContent({ onClose }: { onClose: () => void }) {
  const { project } = useOrganizationTeamProject();
  const { workflowId, getWorkflow, evaluationState } = useWorkflowStore(
    ({ workflow_id: workflowId, getWorkflow, state }) => ({
      workflowId,
      getWorkflow,
      evaluationState: state.evaluation,
    })
  );
  const form = useForm<{ version: string; commitMessage: string }>({
    defaultValues: {
      version: "",
      commitMessage: "",
    },
  });

  const { versions, canSaveNewVersion, nextVersion, versionToBeEvaluated } =
    useVersionState({
      project,
      form,
      allowSaveIfAutoSaveIsCurrentButNotLatest: false,
    });

  const toast = useToast();
  const commitVersion = api.workflow.commitVersion.useMutation();
  const { startEvaluationExecution } = useEvaluationExecution();

  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (hasStarted && evaluationState?.status === "running") {
      onClose();
    }
  }, [evaluationState?.status, hasStarted, onClose]);

  const onSubmit = useCallback(
    async ({
      version,
      commitMessage,
    }: {
      version: string;
      commitMessage: string;
    }) => {
      if (!project || !workflowId) return;

      let versionId: string | undefined = versionToBeEvaluated.id;

      if (canSaveNewVersion) {
        try {
          const versionResponse = await commitVersion.mutateAsync({
            projectId: project.id,
            workflowId,
            commitMessage,
            dsl: {
              ...getWorkflow(),
              version,
            },
          });
          versionId = versionResponse.id;
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

      if (!versionId) {
        toast({
          title: "Version ID not found for evaluation",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
        return;
      }

      startEvaluationExecution({ workflow_version_id: versionId });
      setHasStarted(true);
    },
    [
      canSaveNewVersion,
      commitVersion,
      getWorkflow,
      project,
      startEvaluationExecution,
      toast,
      versionToBeEvaluated.id,
      workflowId,
    ]
  );

  const isRunning = evaluationState?.status === "running";

  if (isRunning) {
    return null;
  }

  if (!versions.data) {
    return (
      <ModalContent>
        <ModalHeader fontWeight={600}>Evaluate Workflow</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="start" width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        </ModalBody>
        <ModalFooter />
      </ModalContent>
    );
  }

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
          <VersionToBeEvaluated
            form={form}
            nextVersion={nextVersion}
            canSaveNewVersion={canSaveNewVersion}
            versionToBeEvaluated={versionToBeEvaluated}
          />
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="outline"
          type="submit"
          alignSelf="end"
          leftIcon={<CheckSquare size={16} />}
          isLoading={evaluationState?.status === "waiting"}
        >
          {canSaveNewVersion ? "Save & Run Evaluation" : "Run Evaluation"}
        </Button>
      </ModalFooter>
    </ModalContent>
  );
}

export const VersionToBeEvaluated = ({
  form,
  nextVersion,
  canSaveNewVersion,
  versionToBeEvaluated,
}: {
  form: UseFormReturn<{ version: string; commitMessage: string }>;
  nextVersion: string;
  canSaveNewVersion: boolean;
  versionToBeEvaluated: {
    id: string | undefined;
    version: string | undefined;
    commitMessage: string | undefined;
  };
}) => {
  if (canSaveNewVersion) {
    return (
      <NewVersionFields
        form={form}
        nextVersion={nextVersion}
        canSaveNewVersion={canSaveNewVersion}
      />
    );
  }

  return (
    <HStack width="full">
      <VStack align="start">
        <SmallLabel color="gray.600">Version</SmallLabel>
        <Text width="74px">{versionToBeEvaluated.version}</Text>
      </VStack>
      <VStack align="start" width="full">
        <SmallLabel color="gray.600">Description</SmallLabel>
        <Text>{versionToBeEvaluated.commitMessage}</Text>
      </VStack>
    </HStack>
  );
};
