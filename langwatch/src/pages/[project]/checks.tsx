import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  LinkBox,
  LinkOverlay,
  Skeleton,
  Spacer,
  Spinner,
  Switch,
  Text,
  VStack,
  useToast,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { Link } from "@chakra-ui/next-js";
import { ChevronLeft, ChevronRight } from "react-feather";

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
        onError: (_error, _newConfig, context) => {
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
      <Container maxWidth="1200" padding={6}>
        <VStack width="fill" spacing={4} align="stretch">
          <HStack paddingTop={4}>
            <Heading as="h1">Automated Checks</Heading>
            <Spacer />
            {toggleConfig.isLoading && <Spinner size="lg" />}
          </HStack>
          <HStack align="end">
            <Text>
              Automated checks are run on the messages that sent for your
              project.
              <br />
              You can use them to validate the output of your messages by using
              the built-in checks or defining custom ones.
            </Text>
            <Spacer />
            <Button
              colorScheme="orange"
              as={NextLink}
              href={`/${project.slug}/checks/new`}
            >
              + Add Check
            </Button>
          </HStack>
          <VStack width="full" paddingTop={6} spacing={4}>
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
                <Card
                  width="full"
                  variant="filled"
                  background="rgba(0,0,0,.05)"
                  boxShadow="none"
                  key={config.id}
                >
                  <CardBody width="full">
                    <HStack width="full" spacing={6}>
                      <Switch
                        size="lg"
                        isChecked={config.enabled}
                        onChange={() => handleToggle(config.id, config.enabled)}
                        position="relative"
                        zIndex={1}
                      />
                      <VStack flexGrow={1} align="start">
                        <Heading as="h3" size="md">
                          {config.name}
                        </Heading>
                        <Text>Runs on every message</Text>
                      </VStack>
                      <LinkOverlay
                        as={NextLink}
                        href={`/${project.slug}/checks/${config.id}/edit`}
                      >
                        <ChevronRight />
                      </LinkOverlay>
                    </HStack>
                  </CardBody>
                </Card>
              ))
            ) : (
              <Alert status="info">
                <AlertIcon />
                No checks found
              </Alert>
            )}
          </VStack>
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
