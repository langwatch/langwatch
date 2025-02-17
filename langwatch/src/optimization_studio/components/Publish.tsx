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
  Spinner,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
  type MenuItemProps,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import {
  ArrowUp,
  ArrowUpCircle,
  Box as BoxIcon,
  CheckCircle,
  Code,
  Lock,
  Play,
} from "react-feather";
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
import { type Edge } from "@xyflow/react";
import { useForm } from "react-hook-form";
import { langwatchEndpoint } from "../../components/code/langwatchEndpointEnv";
import { trackEvent } from "../../utils/tracking";
import { checkIsEvaluator, getEntryInputs } from "../utils/nodeUtils";

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
      <Modal
        isOpen={publishModal.isOpen}
        onClose={publishModal.onClose}
        size={"xl"}
      >
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
  const { workflowId } = useWorkflowStore(({ workflow_id: workflowId }) => ({
    workflowId,
  }));

  const nodes = useWorkflowStore((state) => state.nodes);

  const endNodes = nodes.filter((node) => node.type === "end");

  const isEvaluator = endNodes.some(checkIsEvaluator);

  const { canSaveNewVersion, versionToBeEvaluated } = useVersionState({
    project,
    allowSaveIfAutoSaveIsCurrentButNotLatest: false,
  });
  const router = useRouter();
  const toast = useToast();
  const trpc = api.useContext();

  const publishedWorkflow = api.optimization.getPublishedWorkflow.useQuery(
    {
      workflowId: workflowId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

  const toggleSaveAsComponentMutation =
    api.optimization.toggleSaveAsComponent.useMutation({
      onSuccess: () => {
        void trpc.optimization.getComponents.invalidate();

        toast({
          title: `Workflow ${
            !publishedWorkflow.data?.isComponent ? "saved" : "deleted"
          } as component`,
          status: "success",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
      },
      onError: (error) => {
        toast({
          title: "Error saving component",
          description: error.message,
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
      },
    });

  const toggleSaveAsEvaluatorMutation =
    api.optimization.toggleSaveAsEvaluator.useMutation({
      onSuccess: () => {
        void trpc.optimization.getComponents.invalidate();

        toast({
          title: `Workflow ${
            !publishedWorkflow.data?.isEvaluator ? "saved" : "deleted"
          } as evaluator`,
          status: "success",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
      },
      onError: (error) => {
        toast({
          title: "Error saving evaluator",
          description: error.message,
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
      },
    });

  const canPublish =
    !canSaveNewVersion &&
    publishedWorkflow.data?.version === versionToBeEvaluated.version
      ? "Current version is already published"
      : undefined;

  const toggleSaveAsComponent = () => {
    if (!workflowId || !project?.id) {
      return;
    }

    toggleSaveAsComponentMutation.mutate({
      workflowId,
      projectId: project.id,
      isComponent: !publishedWorkflow.data?.isComponent,
      isEvaluator: publishedWorkflow.data?.isEvaluator ?? false,
    });
  };

  const toggleSaveAsEvaluator = () => {
    if (!workflowId || !project?.id) {
      return;
    }

    toggleSaveAsEvaluatorMutation.mutate({
      workflowId,
      projectId: project.id,
      isEvaluator: !publishedWorkflow.data?.isEvaluator,
      isComponent: publishedWorkflow.data?.isComponent ?? false,
    });
  };

  const { organization } = useOrganizationTeamProject();
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
    }
  );

  const planAllowsToPublish = usage.data && usage.data?.activePlan.canPublish;
  const publishDisabledLabel = !publishedWorkflow.data?.version
    ? "Publish a version to enable this option"
    : undefined;

  const SubscriptionMenuItem = (
    props: MenuItemProps & { tooltip?: string }
  ) => {
    if (!planAllowsToPublish) {
      return (
        <Tooltip
          label="Subscribe to unlock publishing, click to continue"
          placement="right"
        >
          <MenuItem
            {...props}
            icon={usage.data ? <Lock size={16} /> : <Spinner size="sm" />}
            isDisabled={false}
            color="gray.400"
            onClick={() => {
              trackEvent("subscription_hook_click", {
                projectId: project?.id,
                hook: "studio_click_subscribe_to_publish",
              });
              void router.push("/settings/subscription");
            }}
          />
        </Tooltip>
      );
    }
    return (
      <Tooltip label={props.tooltip} placement="right">
        <MenuItem {...props} />
      </Tooltip>
    );
  };

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
      <SubscriptionMenuItem
        tooltip={canPublish}
        onClick={onTogglePublish}
        icon={<ArrowUp size={16} />}
        isDisabled={!!canPublish}
      >
        {canSaveNewVersion || canPublish
          ? "Publish New Version"
          : "Publish Current Version"}
      </SubscriptionMenuItem>

      <SubscriptionMenuItem
        tooltip={publishDisabledLabel}
        isDisabled={!!publishDisabledLabel || isEvaluator}
        onClick={toggleSaveAsComponent}
        icon={<BoxIcon size={16} />}
      >
        {publishedWorkflow.data?.isComponent
          ? "Delete Component"
          : "Save as Component"}
      </SubscriptionMenuItem>

      <SubscriptionMenuItem
        tooltip={
          publishDisabledLabel
            ? publishDisabledLabel
            : !isEvaluator
            ? "Toggle the end node's type to 'Evaluator' to enable this option"
            : undefined
        }
        isDisabled={!!publishDisabledLabel || !isEvaluator}
        onClick={toggleSaveAsEvaluator}
        icon={<CheckCircle size={16} />}
      >
        {publishedWorkflow.data?.isEvaluator
          ? "Delete Evaluator"
          : "Save as Evaluator"}
      </SubscriptionMenuItem>

      <Link
        href={
          !publishedWorkflow.data?.version || !planAllowsToPublish
            ? undefined
            : `/${project?.slug}/chat/${router.query.workflow as string}`
        }
        isExternal
        _hover={{
          textDecoration: "none",
        }}
      >
        <SubscriptionMenuItem
          tooltip={publishDisabledLabel}
          isDisabled={!!publishDisabledLabel}
          icon={<Play size={16} />}
        >
          Run App
        </SubscriptionMenuItem>
      </Link>

      <SubscriptionMenuItem
        tooltip={publishDisabledLabel}
        onClick={onToggleApi}
        isDisabled={!!publishDisabledLabel}
        icon={<Code size={16} />}
      >
        View API Reference
      </SubscriptionMenuItem>
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
        <VStack align="start" width="full" spacing={10}>
          <Text fontSize="15px" color="black">
            Publish your workflow to make it available via API, as a component
            to other workflows, or as a custom evaluator.
          </Text>
          {versionToBeEvaluated && (
            <VersionToBeUsed
              form={form}
              nextVersion={nextVersion}
              canSaveNewVersion={canSaveNewVersion}
              versionToBeEvaluated={versionToBeEvaluated}
            />
          )}
        </VStack>
      </ModalBody>
      <ModalFooter borderTop="1px solid" borderColor="gray.200" marginTop={4}>
        <VStack align="start" width="full" spacing={3}>
          {hasProvidersWithoutCustomKeys && (
            <AddModelProviderKey
              runWhat="publish"
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
                  leftIcon={<ArrowUpCircle size={16} />}
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

  const entryInputs = getEntryInputs(
    (publishedWorkflow.data?.dsl as unknown as Workflow)?.edges,
    (publishedWorkflow.data?.dsl as unknown as Workflow)?.nodes
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
            code={`# Set your API key
LANGWATCH_API_KEY="${project?.apiKey ?? "your_langwatch_api_key"}"

# Use curl to send the POST request, e.g.:
curl -X POST "${langwatchEndpoint()}/api/workflows/${workflowId}/run" \\
     -H "X-Auth-Token: $LANGWATCH_API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
${message}
EOF`}
            language="bash"
          />
        </Box>
        <Text marginTop={4}>
          To retrieve your API key, click{" "}
          <Link
            href={`/${project?.slug}/setup`}
            textDecoration="underline"
            isExternal
          >
            here
          </Link>
          .
        </Text>
        <Text marginTop={4}>
          To access the API details and view more information, please refer to
          the official documentation{" "}
          <Link
            href="https://docs.langwatch.ai"
            textDecoration="underline"
            isExternal
          >
            here
          </Link>
          .
        </Text>
      </ModalBody>
      <ModalFooter></ModalFooter>
    </ModalContent>
  );
};
