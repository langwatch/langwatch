/**
 * LLM Model Costs — every per-token rate the project resolves, catalogue rows
 * and stored overrides together.
 *
 * Green marks a rate that comes from a stored cost rule at whatever scope,
 * rather than from the model catalogue, so a reader can tell at a glance which
 * numbers someone here decided.
 *
 * Moved from `platform/app/src/pages/settings/model-costs.tsx` and the component
 * it was a two-line wrapper around,
 * `platform/app/src/components/settings/LLMModelCost.tsx`. The editor itself is
 * `llmModelCost`, a registered drawer this move does NOT take: the unmapped-cost
 * suggestion inside a trace opens the same drawer, so deleting its registry
 * entry would break a surface that has not moved. The screen names the drawer
 * and the host writes the address — see `ModelProviderHostPort.openPlatformDrawer`
 * for the gap that leaves.
 *
 * Contract: specs/model-providers/model-cost-scoping.feature.
 */

import {
  Button,
  Code,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { MoreVertical, Plus } from "lucide-react";
import { modelProviderApi } from "../../behavior/model-provider-api";
import { toLLMModelCostRow } from "../../model/llm-model-cost-row";
import { useModelProviderHost } from "../../model/model-provider-host";

/** The grant that decides whether cost rules can be written from this page. */
export const MODEL_COST_MANAGE_PERMISSION = "project:manage";

/**
 * One per-token rate, rendered at full precision. Rates run to nine decimal
 * places, so the default number formatting would round several of them to zero.
 */
function RateCell({ rate, isCustom }: { rate: number | undefined; isCustom: boolean }) {
  return (
    <Table.Cell padding={0}>
      <Text
        justifyContent="space-between"
        paddingX={4}
        marginX={2}
        color={isCustom ? "green.500" : undefined}
      >
        {rate?.toLocaleString("fullwide", {
          useGrouping: false,
          maximumSignificantDigits: 20,
        })}
      </Text>
    </Table.Cell>
  );
}

export default function ModelCostsScreen() {
  const host = useModelProviderHost();
  const { projectId } = host.scope();
  const llmModelCosts = modelProviderApi.llmModelCost.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  return (
    <VStack gap={0} paddingTop={2} width="full" align="start">
      <PageLayout.Header withBorder={false}>
        <HStack>
          <Heading>LLM Model Costs</Heading>
          {llmModelCosts.data && (
            <>
              <Text fontSize="md">·</Text>
              <Text fontSize="md" color="fg.muted">
                {llmModelCosts.data.length} models
              </Text>
            </>
          )}
        </HStack>
        <Spacer />
        <PageLayout.HeaderButton
          onClick={() => host.openPlatformDrawer({ drawer: "llmModelCost" })}
          disabled={!host.hasPermission(MODEL_COST_MANAGE_PERMISSION)}
        >
          <Plus size={20} />
          <Text>Add New Model</Text>
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <VStack width="full" gap={0} align="start" paddingY={4} paddingX={4} paddingBottom={12}>
        <Table.Root
          variant="line"
          width="full"
          maxWidth="100%"
          wordBreak="break-all"
          style={{ tableLayout: "fixed" }}
        >
          <Table.Header width="full">
            <Table.Row width="full">
              {/* The five rate columns share what these two leave. A rate runs to
                  nine decimal places and breaks mid-number when its column is
                  narrow, so the identifying columns give up some width to keep
                  the prices readable. */}
              <Table.ColumnHeader width="18%">Model name</Table.ColumnHeader>
              <Table.ColumnHeader width="18%">Regex match rule</Table.ColumnHeader>
              <Table.ColumnHeader>Input cost</Table.ColumnHeader>
              <Table.ColumnHeader>Output cost</Table.ColumnHeader>
              <Table.ColumnHeader>Cache read</Table.ColumnHeader>
              <Table.ColumnHeader>Cache write (5 minutes)</Table.ColumnHeader>
              <Table.ColumnHeader>Cache write (1 hour)</Table.ColumnHeader>
              <Table.ColumnHeader width="64px" padding={1} />
            </Table.Row>
          </Table.Header>
          <Table.Body width="full">
            {llmModelCosts.isLoading &&
              Array.from({ length: 3 }).map((_, rowIndex) => (
                <Table.Row key={rowIndex}>
                  {Array.from({ length: 7 }).map((__, cellIndex) => (
                    <Table.Cell key={cellIndex}>
                      <Skeleton height="20px" />
                    </Table.Cell>
                  ))}
                  <Table.Cell padding={1} />
                </Table.Row>
              ))}
            {llmModelCosts.data?.map(toLLMModelCostRow).map((row) => (
              <Table.Row key={row.model} width="full">
                <Table.Cell>
                  <Text truncate color={row.updatedAt ? "green.500" : undefined}>
                    {row.model}
                  </Text>
                </Table.Cell>
                <Table.Cell padding={0}>
                  <HStack justifyContent="space-between" paddingX={4} marginX={2} maxWidth="100%">
                    <Code
                      truncate
                      color={row.updatedAt ? "green.500" : undefined}
                      height="32px"
                      lineHeight="22px"
                      borderRadius="6px"
                      border="1px solid"
                      borderColor="border"
                      bg="bg.subtle"
                      paddingY={1}
                      paddingX={2}
                    >
                      {row.regex}
                    </Code>
                  </HStack>
                </Table.Cell>
                <RateCell rate={row.inputCostPerToken} isCustom={!!row.id} />
                <RateCell rate={row.outputCostPerToken} isCustom={!!row.id} />
                <RateCell rate={row.cacheReadCostPerToken} isCustom={!!row.id} />
                <RateCell rate={row.cacheCreationCostPerToken} isCustom={!!row.id} />
                <RateCell rate={row.cacheCreation1hCostPerToken} isCustom={!!row.id} />
                <Table.Cell padding={1}>
                  <ActionsMenu id={row.id} model={row.model} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </VStack>
    </VStack>
  );
}

function ActionsMenu({ id, model }: { id?: string; model: string }) {
  const host = useModelProviderHost();
  const { projectId } = host.scope();
  const llmModelCosts = modelProviderApi.llmModelCost.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const deleteLLMModelCost = modelProviderApi.llmModelCost.delete.useMutation();

  return (
    <Menu.Root>
      <Menu.Trigger minWidth={0} asChild>
        <Button variant="ghost">
          <MoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {!id && (
          <Menu.Item
            value="clone"
            onClick={(event) => {
              event.stopPropagation();
              host.openPlatformDrawer({
                drawer: "llmModelCost",
                params: { cloneModel: model },
              });
            }}
          >
            Clone
          </Menu.Item>
        )}
        {id && (
          <Menu.Item
            value="edit"
            onClick={(event) => {
              event.stopPropagation();
              host.openPlatformDrawer({ drawer: "llmModelCost", params: { id } });
            }}
          >
            Edit
          </Menu.Item>
        )}
        {id && (
          <Menu.Item
            value="delete"
            color="red.600"
            onClick={(event) => {
              event.stopPropagation();
              deleteLLMModelCost.mutate(
                { projectId: projectId ?? "", id },
                {
                  onSuccess: () => {
                    host.succeeded({
                      title: "Success",
                      description: "LLM model cost deleted successfully",
                    });
                    void llmModelCosts.refetch();
                  },
                  onError: (error) => {
                    // The application put a refusal on screen itself through a
                    // global interceptor, and toasting it again would say it
                    // twice. Nothing above a package-served screen holds that
                    // interceptor yet, so `isReportedGlobally` answers false and
                    // the toast is what the reader gets — which is the outcome
                    // this branch exists to guarantee either way.
                    if (host.isReportedGlobally(error)) return;
                    host.failed({ error, fallbackTitle: "Error deleting LLM model cost" });
                  },
                },
              );
            }}
          >
            Delete
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
