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
  Skeleton,
  Spacer,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";

import { CheckSquare } from "react-feather";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useModelProviderKeys } from "../hooks/useModelProviderKeys";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { AddModelProviderKey } from "./AddModelProviderKey";
import { useVersionState } from "./History";

export function Publish() {
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
          Publish
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        {isOpen && <PublishModalContent onClose={onClose} />}
      </Modal>
    </>
  );
}

export function PublishModalContent({ onClose }: { onClose: () => void }) {
  const { project } = useOrganizationTeamProject();
  const { hasProvidersWithoutCustomKeys, nodeProvidersWithoutCustomKeys } =
    useModelProviderKeys();
  const { workflowId, evaluationState } = useWorkflowStore(
    ({
      workflow_id: workflowId,
      getWorkflow,
      state,
      deselectAllNodes,
      setOpenResultsPanelRequest,
    }) => ({
      workflowId,
      getWorkflow,
      evaluationState: state.evaluation,
      deselectAllNodes: deselectAllNodes,
      setOpenResultsPanelRequest: setOpenResultsPanelRequest,
    })
  );

  const { versions, versionToBeEvaluated } = useVersionState({
    project,
    allowSaveIfAutoSaveIsCurrentButNotLatest: false,
  });

  const toast = useToast();
  const publishWorkflow = api.workflow.publish.useMutation();

  const onSubmit = () => {
    publishWorkflow.mutate(
      {
        projectId: project?.id ?? "",
        workflowId: workflowId ?? "",
        versionId: versionToBeEvaluated.id ?? "",
      },
      {
        onSuccess: () => {
          toast({
            title: "Workflow published successfully",
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          onClose();
        },
        onError: () => {
          toast({
            title: "Error publishing workflow",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const isRunning = evaluationState?.status === "running";

  if (isRunning) {
    return null;
  }

  if (!versions.data) {
    return (
      <ModalContent borderTop="5px solid" borderColor="green.400">
        <ModalHeader fontWeight={600}>Publish Workflow</ModalHeader>
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
    <ModalContent borderTop="5px solid" borderColor="green.400">
      <ModalHeader fontWeight={600}>Publish Workflow</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <VStack align="start" width="full" spacing={4}>
          <VStack align="start" width="full">
            <VersionToBeEvaluated versionToBeEvaluated={versionToBeEvaluated} />
          </VStack>
        </VStack>
      </ModalBody>
      <ModalFooter borderTop="1px solid" borderColor="gray.200" marginTop={4}>
        <VStack align="start" width="full">
          {hasProvidersWithoutCustomKeys && (
            <AddModelProviderKey
              nodeProvidersWithoutCustomKeys={nodeProvidersWithoutCustomKeys}
            />
          )}
          <HStack width="full">
            <Spacer />
            <Button
              variant="outline"
              type="submit"
              leftIcon={<CheckSquare size={16} />}
              isLoading={evaluationState?.status === "waiting"}
              isDisabled={hasProvidersWithoutCustomKeys}
              onClick={onSubmit}
            >
              Publish Workflow
            </Button>
          </HStack>
        </VStack>
      </ModalFooter>
    </ModalContent>
  );
}

export const VersionToBeEvaluated = ({
  versionToBeEvaluated,
}: {
  versionToBeEvaluated: {
    id: string | undefined;
    version: string | undefined;
    commitMessage: string | undefined;
  };
}) => {
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
