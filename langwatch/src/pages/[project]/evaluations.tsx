import {
  Box,
  Button,
  Card,
  Container,
  Field,
  Heading,
  Skeleton,
  Spacer,
  Spinner,
  Text,
  Alert,
  HStack,
  LinkOverlay,
  VStack,
} from "@chakra-ui/react";
import { ChevronRight } from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { CheckPreconditions } from "../../server/evaluations/types";
import { camelCaseToLowerCase } from "../../utils/stringCasing";
import { TeamRoleGroup } from "../../server/api/permission";
import { toaster } from "../../components/ui/toaster";
import { Switch } from "../../components/ui/switch";
import { Link } from "../../components/ui/link";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import { EvaluationExecutionMode, type Monitor } from "@prisma/client";
import NextLink from "next/link";

export default function Checks() {
  const { project, hasTeamPermission } = useOrganizationTeamProject();
  const checks = api.monitors.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const utils = api.useContext();
  const toggleConfig = api.monitors.toggle.useMutation({
    onMutate: async (newConfig) => {
      await utils.monitors.getAllForProject.cancel();
      const previousConfigs = utils.monitors.getAllForProject.getData({
        projectId: project?.id ?? "",
      });
      const newConfigs = previousConfigs?.map((config) =>
        config.id === newConfig.id
          ? { ...config, enabled: newConfig.enabled }
          : config
      );
      utils.monitors.getAllForProject.setData(
        { projectId: project?.id ?? "" },
        newConfigs
      );
      return { previousConfigs };
    },
  });

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
            utils.monitors.getAllForProject.setData(
              { projectId: project?.id ?? "" },
              context.previousConfigs
            );
          }
          toaster.create({
            title: "Error updating check",
            description: "Please try again",
            type: "error",
            meta: {
              closable: true,
            },
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

  const renderEvaluation = (check: Monitor) => {
    const preconditions = check.preconditions as CheckPreconditions | undefined;

    const sample =
      check.sample >= 1
        ? "every message"
        : `${+(check.sample * 100).toFixed(2)}% of messages`;

    return (
      <Card.Root
        width="full"
        variant="subtle"
        background="rgba(0,0,0,.05)"
        boxShadow="none"
        key={check.id}
      >
        <Card.Body width="full">
          <HStack width="full" gap={6}>
            {hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE) && (
              <Switch
                size="lg"
                checked={check.enabled}
                onCheckedChange={() => handleToggle(check.id, check.enabled)}
                position="relative"
                zIndex={1}
                // @ts-ignore
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
              <LinkOverlay asChild>
                <NextLink
                  href={`/${project.slug}/evaluations/${check.id}/edit`}
                >
                  <ChevronRight />
                </NextLink>
              </LinkOverlay>
            )}
          </HStack>
        </Card.Body>
      </Card.Root>
    );
  };

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <VStack width="fill" gap={4} align="stretch">
          <HStack paddingTop={4}>
            <Heading as="h1">Guardrails and Evaluations</Heading>
            <Spacer />
            {toggleConfig.isLoading && <Spinner />}
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
              <Link asChild href={`/${project.slug}/evaluations/new/choose`}>
                <Button colorPalette="orange" minWidth="fit-content">
                  + Add
                </Button>
              </Link>
            )}
          </HStack>
          <VStack align="start" width="full" gap={4}>
            {checks.isLoading ? (
              <VStack gap={4} width="full">
                <Skeleton width="full" height="20px" />
                <Skeleton width="full" height="20px" />
                <Skeleton width="full" height="20px" />
              </VStack>
            ) : checks.isError ? (
              <Alert.Root>
                <Alert.Indicator />
                <Alert.Content>An error has occurred</Alert.Content>
              </Alert.Root>
            ) : checks.data && checks.data.length > 0 ? (
              <>
                {(evaluations?.length ?? 0) > 0 &&
                (guardrails?.length ?? 0) > 0 ? (
                  <Heading as="h2" size="md" paddingTop={6}>
                    Guardrails
                  </Heading>
                ) : (
                  <Box paddingTop={2}></Box>
                )}
                {guardrails?.map(renderEvaluation)}

                {(evaluations?.length ?? 0) > 0 &&
                  (guardrails?.length ?? 0) > 0 && (
                    <Heading as="h2" size="md" paddingTop={6}>
                      Evaluations
                    </Heading>
                  )}
                {evaluations?.map(renderEvaluation)}
              </>
            ) : (
              <Alert.Root>
                <Alert.Indicator />
                <Alert.Content>No evaluations configured</Alert.Content>
              </Alert.Root>
            )}
          </VStack>
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
