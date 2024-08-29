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
import { ChevronRight } from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { CheckPreconditions } from "../../server/evaluations/types";
import { camelCaseToLowerCase } from "../../utils/stringCasing";
import { TeamRoleGroup } from "../../server/api/permission";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import {
  EvaluationExecutionMode,
  type Check,
} from "@prisma/client";

export default function Checks() {
  const { project, hasTeamPermission } = useOrganizationTeamProject();
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

  const evaluations = checks.data?.filter(
    (check) => check.executionMode !== EvaluationExecutionMode.AS_GUARDRAIL
  );
  const guardrails = checks.data?.filter(
    (check) => check.executionMode === EvaluationExecutionMode.AS_GUARDRAIL
  );

  const renderEvaluation = (check: Check) => {
    const preconditions = check.preconditions as CheckPreconditions | undefined;

    const sample =
      check.sample >= 1
        ? "every message"
        : `${+(check.sample * 100).toFixed(2)}% of messages`;

    return (
      <Card
        width="full"
        variant="filled"
        background="rgba(0,0,0,.05)"
        boxShadow="none"
        key={check.id}
      >
        <CardBody width="full">
          <HStack width="full" spacing={6}>
            {hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
              <Switch
                size="lg"
                isChecked={check.enabled}
                onChange={() => handleToggle(check.id, check.enabled)}
                position="relative"
                zIndex={1}
                variant="darkerTrack"
              />
            )}
            <VStack flexGrow={1} align="start">
              <Heading as="h3" size="md">
                {check.name}
              </Heading>
              {!hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
                <Text>
                  {
                    AVAILABLE_EVALUATORS[check.checkType as EvaluatorTypes]
                      .description
                  }
                </Text>
              )}
              <Text>
                {!preconditions?.length
                  ? `Runs on ${sample}`
                  : preconditions.length === 1
                  ? `Runs ${
                      check.sample < 1 ? "on " + sample + " in which" : "when"
                    } ${preconditions[0]?.field} ${camelCaseToLowerCase(
                      preconditions[0]?.rule ?? ""
                    )} "${preconditions[0]?.value}"`
                  : `Runs on ${sample} matching ${preconditions.length} preconditions`}
              </Text>
            </VStack>
            {hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
              <LinkOverlay
                as={NextLink}
                href={`/${project.slug}/evaluations/${check.id}/edit`}
              >
                <ChevronRight />
              </LinkOverlay>
            )}
          </HStack>
        </CardBody>
      </Card>
    );
  };

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack width="fill" spacing={4} align="stretch">
          <HStack paddingTop={4}>
            <Heading as="h1">Guardrails and Evaluations</Heading>
            <Spacer />
            {toggleConfig.isLoading && <Spinner size="lg" />}
          </HStack>
          <HStack align="end">
            <Text>
              Setup automated evaluations to run on your project messages.
              <br />
              You can use them to validate security and quality by using the
              built-in evaluations or defining custom ones.
            </Text>
            <Spacer />
            {hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
              <Button
                colorScheme="orange"
                as={NextLink}
                href={`/${project.slug}/evaluations/new/choose`}
                minWidth="fit-content"
              >
                + Add
              </Button>
            )}
          </HStack>
          <VStack align="start" width="full" spacing={4}>
            {checks.isLoading ? (
              <VStack gap={4} width="full">
                <Skeleton width="full" height="20px" />
                <Skeleton width="full" height="20px" />
                <Skeleton width="full" height="20px" />
              </VStack>
            ) : checks.isError ? (
              <Alert status="error">
                <AlertIcon />
                An error has occurred
              </Alert>
            ) : checks.data && checks.data.length > 0 ? (
              <>
                {(evaluations?.length ?? 0) > 0 &&
                (guardrails?.length ?? 0) > 0 ? (
                  <Heading as="h2" size="lg" paddingTop={6}>
                    Guardrails
                  </Heading>
                ) : (
                  <Box paddingTop={2}></Box>
                )}
                {guardrails?.map(renderEvaluation)}

                {(evaluations?.length ?? 0) > 0 &&
                  (guardrails?.length ?? 0) > 0 && (
                    <Heading as="h2" size="lg" paddingTop={6}>
                      Evaluations
                    </Heading>
                  )}
                {evaluations?.map(renderEvaluation)}
              </>
            ) : (
              <Alert status="info">
                <AlertIcon />
                No evaluations configured
              </Alert>
            )}
          </VStack>
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
