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
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import { Code, Globe, Play } from "react-feather";
import { RenderCode } from "~/components/code/RenderCode";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useModelProviderKeys } from "../hooks/useModelProviderKeys";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Workflow } from "../types/dsl";
import { AddModelProviderKey } from "./AddModelProviderKey";
import { useVersionState, VersionToBeUsed } from "./History";

import type { Project } from "@prisma/client";
import { type Edge, type Node } from "@xyflow/react";
import { useForm } from "react-hook-form";

export function Publish({ isDisabled }: { isDisabled: boolean }) {
  const publishModal = useDisclosure();
  const apiModal = useDisclosure();
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
            <MenuList zIndex={101}>
              {isOpen && project && (
                <PublishMenu
                  project={project}
                  onTogglePublish={publishModal.onToggle}
                  onToggleApi={apiModal.onToggle}
                />
              )}
            </MenuList>
          </>
        )}
      </Menu>
      <Modal isOpen={publishModal.isOpen} onClose={publishModal.onClose}>
        <ModalOverlay />
        {publishModal.isOpen && (
          <PublishModalContent
            onClose={publishModal.onClose}
            onApiToggle={apiModal.onToggle}
          />
        )}
      </Modal>
      <Modal isOpen={apiModal.isOpen} onClose={apiModal.onClose} size={"2xl"}>
        <ModalOverlay />
        {apiModal.isOpen && <ApiModalContent />}
      </Modal>
    </>
  );
}

function PublishMenu({
  project,
  onTogglePublish,
  onToggleApi,
}: {
  project: Project;
  onTogglePublish: () => void;
  onToggleApi: () => void;
}) {
  const { canSaveNewVersion, versionToBeEvaluated } = useVersionState({
    project,
    allowSaveIfAutoSaveIsCurrentButNotLatest: false,
  });
  const router = useRouter();
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

  const isDisabled =
    !canSaveNewVersion &&
    publishedWorkflow.data?.version === versionToBeEvaluated.version
      ? "Current version is already published"
      : undefined;

  return (
    <>
      {publishedWorkflow.data?.version && (
        <>
          <HStack px={3}>
            <SmallLabel color="gray.600">Published Version</SmallLabel>
            <Text fontSize="xs">{publishedWorkflow.data?.version}</Text>
          </HStack>
          <MenuDivider />
        </>
      )}
      <Tooltip label={isDisabled} placement="right">
        <MenuItem
          onClick={onTogglePublish}
          icon={<Globe size={16} />}
          isDisabled={!!isDisabled}
        >
          {canSaveNewVersion || isDisabled
            ? "Publish New Version"
            : "Publish Current Version"}
        </MenuItem>
      </Tooltip>

      <Link
        href={
          !publishedWorkflow.data?.version
            ? undefined
            : `/${project?.slug}/chat/${router.query.workflow as string}`
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
        onClick={onToggleApi}
        isDisabled={!publishedWorkflow.data?.version}
        icon={<Code size={16} />}
      >
        View API Reference
      </MenuItem>
    </>
  );
}

function PublishModalContent({
  onClose,
  onApiToggle,
}: {
  onClose: () => void;
  onApiToggle: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const { hasProvidersWithoutCustomKeys, nodeProvidersWithoutCustomKeys } =
    useModelProviderKeys();
  const { workflowId, getWorkflow } = useWorkflowStore(
    ({ workflow_id: workflowId, getWorkflow }) => ({
      workflowId,
      getWorkflow,
    })
  );

  const form = useForm<{
    version: string;
    commitMessage: string;
  }>({
    defaultValues: {
      version: "",
      commitMessage: "",
    },
  });

  const formVersion = form.watch("version");

  const { versions, versionToBeEvaluated, nextVersion, canSaveNewVersion } =
    useVersionState({
      project,
      form,
      allowSaveIfAutoSaveIsCurrentButNotLatest: false,
    });

  const toast = useToast();
  const publishWorkflow = api.workflow.publish.useMutation();

  const [isPublished, setIsPublished] = useState(false);

  const commitVersion = api.workflow.commitVersion.useMutation();
  const publishedWorkflow = api.optimization.getPublishedWorkflow.useQuery(
    {
      workflowId: workflowId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

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

      void versions.refetch();
      void publishedWorkflow.refetch();

      publishWorkflow.mutate(
        {
          projectId: project?.id ?? "",
          workflowId: workflowId ?? "",
          versionId,
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
    },
    [
      canSaveNewVersion,
      commitVersion,
      getWorkflow,
      project,
      publishWorkflow,
      publishedWorkflow,
      toast,
      versionToBeEvaluated.id,
      versions,
      workflowId,
    ]
  );

  const openApiModal = () => {
    onApiToggle();
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

  const isDisabled = hasProvidersWithoutCustomKeys
    ? "Set up your API keys to publish a new version"
    : false;

  return (
    <ModalContent
      as="form"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={form.handleSubmit(onSubmit)}
      borderTop="5px solid"
      borderColor="green.400"
    >
      <ModalHeader fontWeight={600}>Publish Workflow</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <VStack align="start" width="full" spacing={4}>
          <VStack align="start" width="full">
            {versionToBeEvaluated && (
              <VersionToBeUsed
                form={form}
                nextVersion={nextVersion}
                canSaveNewVersion={canSaveNewVersion}
                versionToBeEvaluated={versionToBeEvaluated}
              />
            )}
          </VStack>
        </VStack>
      </ModalBody>
      <ModalFooter borderTop="1px solid" borderColor="gray.200" marginTop={4}>
        <VStack align="start" width="full" spacing={3}>
          {hasProvidersWithoutCustomKeys && (
            <AddModelProviderKey
              nodeProvidersWithoutCustomKeys={nodeProvidersWithoutCustomKeys}
            />
          )}
          {!isPublished && (
            <Tooltip label={isDisabled}>
              <HStack width="full">
                <Spacer />
                <Button
                  variant="outline"
                  type="submit"
                  leftIcon={<Globe size={16} />}
                  isLoading={
                    commitVersion.isLoading || publishWorkflow.isLoading
                  }
                  isDisabled={!!isDisabled}
                >
                  {isDisabled
                    ? "Publish"
                    : `Publish Version ${
                        canSaveNewVersion
                          ? formVersion
                          : versionToBeEvaluated.version
                      }`}
                </Button>
              </HStack>
            </Tooltip>
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
