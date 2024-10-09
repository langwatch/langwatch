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
  useDisclosure,
  useToast,
  VStack,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Link,
  Box,
} from "@chakra-ui/react";
import { ChevronDownIcon } from "@chakra-ui/icons";
import { CheckSquare } from "react-feather";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useModelProviderKeys } from "../hooks/useModelProviderKeys";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { AddModelProviderKey } from "./AddModelProviderKey";
import { useVersionState } from "./History";
import { useRouter } from "next/router";
import { RenderCode } from "~/components/code/RenderCode";
import type { Workflow } from "../types/dsl";

import { type Edge, type Node } from "@xyflow/react";

export function Publish({ isDisabled }: { isDisabled: boolean }) {
  //const { isOpen, onToggle, onClose } = useDisclosure();

  const publishModal = useDisclosure();
  const apiModal = useDisclosure();
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  return (
    <>
      <Menu>
        {({ isOpen }) => (
          <>
            <MenuButton
              isActive={isOpen}
              isDisabled={isDisabled}
              as={Button}
              size="sm"
              rightIcon={<ChevronDownIcon />}
              colorScheme="blue"
            >
              Publish
            </MenuButton>
            <MenuList zIndex={9999}>
              <MenuItem onClick={publishModal.onToggle}>
                Publish Workflow
              </MenuItem>
              <Link
                href={`/${project?.slug}/chat/${
                  router.query.workflow as string
                }`}
                isExternal
              >
                <MenuItem>Run App</MenuItem>
              </Link>
              <MenuItem onClick={apiModal.onToggle}>Workflow API</MenuItem>
            </MenuList>
          </>
        )}
      </Menu>
      <Modal isOpen={publishModal.isOpen} onClose={publishModal.onClose}>
        <ModalOverlay />
        {publishModal.isOpen && (
          <PublishModalContent onClose={publishModal.onClose} />
        )}
      </Modal>
      <Modal isOpen={apiModal.isOpen} onClose={apiModal.onClose} size={"2xl"}>
        <ModalOverlay />
        {apiModal.isOpen && <ApiModalContent />}
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

  const { versions, currentVersion } = useVersionState({
    project,
    allowSaveIfAutoSaveIsCurrentButNotLatest: false,
  });

  // const versionToBeSaved = versions.data
  //   ?.sort((a, b) => b.version.localeCompare(a.version)) // Sort by version ID in descending order
  //   .find((version) => version.autoSaved === false);

  const toast = useToast();
  const publishWorkflow = api.workflow.publish.useMutation();

  const onSubmit = () => {
    publishWorkflow.mutate(
      {
        projectId: project?.id ?? "",
        workflowId: workflowId ?? "",
        versionId: currentVersion?.id ?? "",
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
            {currentVersion && (
              <VersionToBeEvaluated versionToBeEvaluated={currentVersion} />
            )}
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

export const ApiModalContent = () => {
  const { workflowId } = useWorkflowStore(({ workflow_id: workflowId }) => ({
    workflowId,
  }));

  const { project } = useOrganizationTeamProject();

  const publishedWorkflow = api.optimization.getPublishedWorkflow.useQuery(
    {
      workflowId: workflowId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

  if (!publishedWorkflow.data) {
    return;
  }

  console.log(publishedWorkflow.data);

  const entryEdges =
    (publishedWorkflow.data?.dsl as unknown as Workflow)?.edges?.filter(
      (edge: Edge) => edge.source === "entry"
    ) ?? [];
  const evaluators = (
    publishedWorkflow.data?.dsl as unknown as Workflow
  )?.nodes?.filter((node: Node) => node.type === "evaluator");

  const entryInputs = entryEdges.filter(
    (edge: Edge) =>
      !evaluators?.some((evaluator: Node) => evaluator.id === edge.target)
  );

  const message = JSON.stringify(
    entryInputs.reduce(
      (obj: Record<string, string>, edge: Edge) => {
        const sourceHandle = edge.sourceHandle?.split(".")[1];
        if (sourceHandle) obj[sourceHandle] = "";
        return obj;
      },
      {} as Record<string, string>
    ),
    null,
    2
  );
  return (
    <ModalContent>
      <ModalHeader>Workflow API</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <Text paddingBottom={8}>
          Incorporate the following JSON payload within the body of your HTTP
          POST request to get the workflow result.
        </Text>
        <Box padding={4} backgroundColor={"#272822"}>
          <RenderCode
            code={`# Set your API key and endpoint URL
API_KEY="your_langwatch_api_key"
ENDPOINT="https://app.langwatch.ai/api/
          optimization/${workflowId}"

# Use curl to send the POST request, e.g.:
curl -X POST "$ENDPOINT" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
${message}
EOF`}
            language="bash"
          />
        </Box>
        <Text marginTop={4}>
          To access the API details and view more information, please refer to
          the official documentation{" "}
          <Link href="https://docs.langwatch.ai">here</Link>.
        </Text>
      </ModalBody>
      <ModalFooter></ModalFooter>
    </ModalContent>
  );
};
