import {
  Alert,
  Box,
  Button,
  HStack,
  Skeleton,
  Spacer,
  Spinner,
  Text,
  useDisclosure,
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

import { Separator } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { type Edge } from "@xyflow/react";
import { ChevronDown } from "react-feather";
import { useForm } from "react-hook-form";
import { langwatchEndpoint } from "../../components/code/langwatchEndpointEnv";
import { Dialog } from "../../components/ui/dialog";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { trackEvent } from "../../utils/tracking";
import { checkIsEvaluator, getEntryInputs } from "../utils/nodeUtils";

export function Publish({ isDisabled }: { isDisabled: boolean }) {
  const publishModal = useDisclosure();
  const apiModal = useDisclosure();
  const { project } = useOrganizationTeamProject();

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button disabled={isDisabled} size="sm" colorPalette="blue">
            Publish <ChevronDown />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {project && (
            <PublishMenu
              project={project}
              onTogglePublish={publishModal.onToggle}
              onToggleApi={apiModal.onToggle}
            />
          )}
        </Menu.Content>
      </Menu.Root>

      <Dialog.Root
        open={publishModal.open}
        onOpenChange={({ open }) => publishModal.setOpen(open)}
        size="md"
      >
        <Dialog.Backdrop />
        {publishModal.open && (
          <PublishModalContent
            onClose={publishModal.onClose}
            onApiToggle={apiModal.onToggle}
          />
        )}
      </Dialog.Root>

      <Dialog.Root
        open={apiModal.open}
        onOpenChange={({ open }) => apiModal.setOpen(open)}
        size="lg"
      >
        <Dialog.Backdrop />
        {apiModal.open && <ApiModalContent />}
      </Dialog.Root>
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

        toaster.create({
          title: `Workflow ${
            !publishedWorkflow.data?.isComponent ? "saved" : "deleted"
          } as component`,
          type: "success",
          duration: 5000,
          meta: {
            closable: true,
          },
          placement: "top-end",
        });
      },
      onError: (error) => {
        toaster.create({
          title: "Error saving component",
          description: error.message,
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
          placement: "top-end",
        });
      },
    });

  const toggleSaveAsEvaluatorMutation =
    api.optimization.toggleSaveAsEvaluator.useMutation({
      onSuccess: () => {
        void trpc.optimization.getComponents.invalidate();

        toaster.create({
          title: `Workflow ${
            !publishedWorkflow.data?.isEvaluator ? "saved" : "deleted"
          } as evaluator`,
          type: "success",
          duration: 5000,
          meta: {
            closable: true,
          },
          placement: "top-end",
        });
      },
      onError: (error) => {
        toaster.create({
          title: "Error saving evaluator",
          description: error.message,
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
          placement: "top-end",
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
          content="Subscribe to unlock publishing, click to continue"
          positioning={{ placement: "right" }}
        >
          <Menu.Item
            {...props}
            disabled={false}
            color="gray.400"
            onClick={() => {
              trackEvent("subscription_hook_click", {
                projectId: project?.id,
                hook: "studio_click_subscribe_to_publish",
              });
              void router.push("/settings/subscription");
            }}
          >
            {usage.data ? <Lock size={16} /> : <Spinner size="sm" />}
            {props.children}
          </Menu.Item>
        </Tooltip>
      );
    }
    return (
      <Tooltip content={props.tooltip} positioning={{ placement: "right" }}>
        <Menu.Item {...props} />
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
          <Separator />
        </>
      )}
      <SubscriptionMenuItem
        tooltip={canPublish}
        onClick={onTogglePublish}
        disabled={!!canPublish}
        value="publish"
      >
        <ArrowUp size={16} />{" "}
        {canSaveNewVersion || canPublish
          ? "Publish New Version"
          : "Publish Current Version"}
      </SubscriptionMenuItem>

      <SubscriptionMenuItem
        tooltip={publishDisabledLabel}
        disabled={!!publishDisabledLabel || isEvaluator}
        value="component"
        onClick={toggleSaveAsComponent}
      >
        <BoxIcon size={16} />{" "}
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
        disabled={!!publishDisabledLabel || !isEvaluator}
        onClick={toggleSaveAsEvaluator}
        value="evaluator"
      >
        <CheckCircle size={16} />{" "}
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
          disabled={!!publishDisabledLabel}
          value="run-app"
        >
          <Play size={16} /> Run App
        </SubscriptionMenuItem>
      </Link>

      <SubscriptionMenuItem
        tooltip={publishDisabledLabel}
        onClick={onToggleApi}
        disabled={!!publishDisabledLabel}
        value="api-reference"
      >
        <Code size={16} /> View API Reference
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

  const { workflowId, getWorkflow } = useWorkflowStore(
    ({ workflow_id: workflowId, getWorkflow }) => ({
      workflowId,
      getWorkflow,
    })
  );

  const { hasProvidersWithoutCustomKeys, nodeProvidersWithoutCustomKeys } =
    useModelProviderKeys({
      workflow: getWorkflow(),
    });

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
          toaster.create({
            title: "Error saving version",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          throw error;
        }
      }

      if (!versionId) {
        toaster.create({
          title: "Version ID not found for evaluation",
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
          placement: "top-end",
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
            toaster.create({
              title: "Error publishing workflow",
              type: "error",
              duration: 5000,
              meta: {
                closable: true,
              },
              placement: "top-end",
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
      <Dialog.Content borderTop="5px solid" borderColor="green.400">
        <Dialog.Header>
          <Dialog.Title fontWeight={600}>Publish Workflow</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <VStack align="start" width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer />
      </Dialog.Content>
    );
  }

  const isDisabled = hasProvidersWithoutCustomKeys
    ? "Set up your API keys to publish a new version"
    : false;

  return (
    <Dialog.Content
      as="form"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={form.handleSubmit(onSubmit)}
      borderTop="5px solid"
      borderColor="green.400"
    >
      <Dialog.Header>
        <Dialog.Title fontWeight={600}>Publish Workflow</Dialog.Title>
      </Dialog.Header>
      <Dialog.CloseTrigger />
      <Dialog.Body>
        <VStack align="start" width="full" gap={10}>
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
      </Dialog.Body>
      <Dialog.Footer borderTop="1px solid" borderColor="gray.200" marginTop={4}>
        <VStack align="start" width="full" gap={3}>
          {hasProvidersWithoutCustomKeys && (
            <AddModelProviderKey
              runWhat="publish"
              nodeProvidersWithoutCustomKeys={nodeProvidersWithoutCustomKeys}
            />
          )}
          {!isPublished && (
            <Tooltip content={isDisabled}>
              <HStack width="full">
                <Spacer />
                <Button
                  variant="outline"
                  type="submit"
                  loading={commitVersion.isLoading || publishWorkflow.isLoading}
                  disabled={!!isDisabled}
                >
                  <ArrowUpCircle size={16} />{" "}
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
              <Alert.Root status="success">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>New version published</Alert.Description>
                </Alert.Content>
              </Alert.Root>
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
                  <Button colorPalette="green" variant="outline">
                    <Play size={16} /> Run App
                  </Button>
                </Link>
                <Button
                  colorPalette="green"
                  onClick={() => openApiModal()}
                  variant="outline"
                >
                  <Code size={16} /> View API Reference
                </Button>
              </VStack>
            </VStack>
          )}
        </VStack>
      </Dialog.Footer>
    </Dialog.Content>
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
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Workflow API</Dialog.Title>
      </Dialog.Header>
      <Dialog.CloseTrigger />
      <Dialog.Body>
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
      </Dialog.Body>
      <Dialog.Footer />
    </Dialog.Content>
  );
};
