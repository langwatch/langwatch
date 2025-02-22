import {
  Button,
  Divider,
  Heading,
  HStack,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { WorkflowIcon } from "../ColorfulBlockIcons";
import { MoreVertical } from "react-feather";
import { api } from "../../../utils/api";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/api/root";

export function WorkflowCardBase(props: React.ComponentProps<typeof VStack>) {
  return (
    <VStack
      align="start"
      padding={4}
      gap={4}
      borderRadius={8}
      background="white"
      boxShadow="md"
      height="200px"
      cursor="pointer"
      role="button"
      transition="all 0.2s ease-in-out"
      _hover={{
        boxShadow: "lg",
        textDecoration: "none",
      }}
      {...props}
    >
      {props.children}
    </VStack>
  );
}

export function WorkflowCard({
  workflowId,
  query,
  name,
  icon,
  description,
  children,
  ...props
}: {
  workflowId?: string;
  query?: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["workflow"]["getAll"],
    TRPCClientErrorLike<AppRouter>
  >;
  name: string;
  icon: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
} & React.ComponentProps<typeof WorkflowCardBase>) {
  const { project } = useOrganizationTeamProject();
  const archiveWorkflow = api.workflow.archive.useMutation();
  const toast = useToast();

  const onArchiveWorkflow = useCallback(() => {
    if (!workflowId || !project) return;

    archiveWorkflow.mutate(
      { workflowId, projectId: project.id },
      {
        onSuccess: () => {
          void query?.refetch();
          toast({
            title: `Workflow ${name} deleted`,
            description: (
              <HStack>
                <Button
                  colorPalette="white"
                  variant="link"
                  textDecoration="underline"
                  onClick={() => {
                    toast.close(`delete-workflow-${workflowId}`);
                    setTimeout(() => {
                      void query?.refetch();
                    }, 1000);
                    archiveWorkflow.mutate(
                      {
                        projectId: project?.id ?? "",
                        workflowId,
                        unarchive: true,
                      },
                      {
                        onSuccess: () => {
                          void query?.refetch();
                          toast({
                            title: "Workflow restored",
                            description: "The workflow has been restored.",
                            status: "success",
                            duration: 5000,
                            isClosable: true,
                            position: "top-right",
                          });
                        },
                      }
                    );
                  }}
                >
                  Undo
                </Button>
              </HStack>
            ),
            id: `delete-workflow-${workflowId}`,
            status: "success",
            duration: 10_000,
            isClosable: true,
            position: "top-right",
          });
        },
        onError: () => {
          toast({
            title: "Error deleting workflow",
            description: "Please try again later.",
            status: "error",
          });
        },
      }
    );
  }, [archiveWorkflow, name, project, query, toast, workflowId]);

  return (
    <WorkflowCardBase paddingX={0} {...props}>
      <HStack gap={4} paddingX={4} width="full">
        <WorkflowIcon icon={icon} size={"lg"} />
        <Heading as={"h2"} size="sm" fontWeight={600}>
          {name}
        </Heading>
        <Spacer />
        {workflowId && (
          <Menu>
            <MenuButton className="js-inner-menu">
              <MoreVertical size={24} />
            </MenuButton>
            <MenuList className="js-inner-menu">
              <MenuItem color="red.500" onClick={onArchiveWorkflow}>
                Delete
              </MenuItem>
            </MenuList>
          </Menu>
        )}
      </HStack>
      <Divider />
      {description && (
        <Text paddingX={4} color="gray.600" fontSize={14}>
          {description}
        </Text>
      )}
      {children}
    </WorkflowCardBase>
  );
}
