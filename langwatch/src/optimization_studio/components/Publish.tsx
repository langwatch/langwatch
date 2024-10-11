import { ChevronDownIcon } from "@chakra-ui/icons";
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  HStack,
  Link,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
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
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useState } from "react";
import {
  CheckSquare,
  FileText,
  Play,
  Code,
  Upload,
  Globe,
} from "react-feather";
import { RenderCode } from "~/components/code/RenderCode";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useModelProviderKeys } from "../hooks/useModelProviderKeys";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Workflow } from "../types/dsl";
import { AddModelProviderKey } from "./AddModelProviderKey";
import { useVersionState } from "./History";

import { type Edge, type Node } from "@xyflow/react";

export function Publish({ isDisabled }: { isDisabled: boolean }) {
  const publishModal = useDisclosure();
  const apiModal = useDisclosure();
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const workflowId = router.query.workflow as string;

  const publishedWorkflow = api.optimization.getPublishedWorkflow.useQuery(
    {
      workflowId: workflowId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

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
              {publishedWorkflow.data?.version && (
                <>
                  {/* <MenuDivider /> */}
                  <HStack px={3}>
                    <SmallLabel color="gray.600">Published Version</SmallLabel>
                    <Text fontSize="xs">{publishedWorkflow.data?.version}</Text>
                  </HStack>
                  <MenuDivider />
                </>
              )}
              <MenuItem
                onClick={publishModal.onToggle}
                icon={<Globe size={16} />}
              >
                Publish New Version
              </MenuItem>

              <Link
                href={
                  !publishedWorkflow.data?.version
                    ? undefined
                    : `/${project?.slug}/chat/${
                        router.query.workflow as string
                      }`
                }
                isExternal
                _hover={{
                  textDecoration: "none",
                }}
              >
                <MenuItem
                  isDisabled={!publishedWorkflow.data?.version}
                  icon={<Play size={16} />}
                >
                  Run App
                </MenuItem>
              </Link>
              <MenuItem
                onClick={apiModal.onToggle}
                isDisabled={!publishedWorkflow.data?.version}
                icon={<Code size={16} />}
              >
                View API Reference
              </MenuItem>
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

  function PublishModalContent({ onClose }: { onClose: () => void }) {
    const { project } = useOrganizationTeamProject();
    const router = useRouter();

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

    const { versions, currentVersion, versionToBeEvaluated } = useVersionState({
      project,
      allowSaveIfAutoSaveIsCurrentButNotLatest: false,
    });

    const toast = useToast();
    const publishWorkflow = api.workflow.publish.useMutation();

    const [isPublished, setIsPublished] = useState(false);

    const onSubmit = () => {
      publishWorkflow.mutate(
        {
          projectId: project?.id ?? "",
          workflowId: workflowId ?? "",
          versionId: currentVersion?.id ?? "",
        },
        {
          onSuccess: () => {
            setIsPublished(true);
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

    const openApiModal = () => {
      apiModal.onToggle();
      onClose();
    };

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
              {versionToBeEvaluated && (
                <VersionToBeEvaluated
                  versionToBeEvaluated={versionToBeEvaluated}
                />
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
            {!isPublished && (
              <HStack width="full">
                <Spacer />
                <Button
                  variant="outline"
                  type="submit"
                  leftIcon={<Globe size={16} />}
                  isLoading={publishWorkflow.isLoading}
                  isDisabled={hasProvidersWithoutCustomKeys}
                  onClick={onSubmit}
                >
                  Publish New Version
                </Button>
              </HStack>
            )}
            {isPublished && (
              <VStack align="start" width="full">
                <Alert status="success">
                  <AlertIcon />
                  New version published
                </Alert>
                <VStack width="full" align="start">
                  <Link
                    href={`/${project?.slug}/chat/${
                      router.query.workflow as string
                    }`}
                    isExternal
                    _hover={{
                      textDecoration: "none",
                    }}
                  >
                    <Button
                      colorScheme="green"
                      leftIcon={<Play size={16} />}
                      variant="outline"
                    >
                      Run App
                    </Button>
                  </Link>
                  <Button
                    colorScheme="green"
                    onClick={() => openApiModal()}
                    leftIcon={<Code size={16} />}
                    variant="outline"
                  >
                    View API Reference
                  </Button>
                </VStack>
              </VStack>
            )}
          </VStack>
        </ModalFooter>
      </ModalContent>
    );
  }
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
