import {
  Heading,
  Button,
  VStack,
  HStack,
  Switch,
  useToast,
  AlertIcon,
  Alert,
  Skeleton,
} from "@chakra-ui/react";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import NextLink from "next/link";

export default function Checks() {
  const { project } = useOrganizationTeamProject();
  const checks = api.checks.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const utils = api.useContext();
  const toggleConfig = api.checks.toggle.useMutation({
    onMutate: async (newConfig) => {
      await utils.checks.getAllForProject.cancel();
      const previousConfigs = utils.checks.getAllForProject.getData({
        projectId: project?.id ?? "",
      });
      const newConfigs = previousConfigs?.map((config) =>
        config.id === newConfig.id
          ? { ...config, enabled: newConfig.enabled }
          : config
      );
      utils.checks.getAllForProject.setData(
        { projectId: project?.id ?? "" },
        newConfigs
      );
      return { previousConfigs };
    },
  });
  const toast = useToast();

  if (!project) return null;

  const handleToggle = (configId: string, enabled: boolean) => {
    toggleConfig.mutate(
      {
        id: configId,
        projectId: project.id,
        enabled: !enabled,
      },
      {
        onError: (error, _newConfig, context) => {
          if (context?.previousConfigs) {
            utils.checks.getAllForProject.setData(
              { projectId: project?.id ?? "" },
              context.previousConfigs
            );
          }
          toast({
            title: "Error updating check",
            description: "Please try again",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        },
        onSettled: () => {
          void checks.refetch();
        },
      }
    );
  };

  return (
    <DashboardLayout>
      <VStack spacing={4} align="stretch">
        <HStack justifyContent="space-between">
          <Heading as="h1">Trace Check Configs</Heading>
          <Button as={NextLink} href={`/${project.slug}/checks/new`}>
            + Add Check
          </Button>
        </HStack>
        {checks.isLoading ? (
          <VStack gap={4} width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        ) : checks.isError ? (
          <Alert status="error">
            <AlertIcon />
            An error has occurred trying to load the check configs
          </Alert>
        ) : checks.data && checks.data.length > 0 ? (
          checks.data.map((config) => (
            <HStack key={config.id} justifyContent="space-between">
              <span>{config.name}</span>
              <HStack>
                <Switch
                  isChecked={config.enabled}
                  onChange={() => handleToggle(config.id, config.enabled)}
                />
                <Button
                  as={NextLink}
                  href={`/${project.slug}/checks/${config.id}/edit`}
                >
                  Edit
                </Button>
              </HStack>
            </HStack>
          ))
        ) : (
          <Alert status="info">
            <AlertIcon />
            No checks found
          </Alert>
        )}
      </VStack>
    </DashboardLayout>
  );
}
