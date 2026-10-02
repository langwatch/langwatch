/**
 * Green marks a rate from a stored cost rule rather than the model catalogue. The `llmModelCost`
 * drawer stays registered outside this move — a trace's unmapped-cost suggestion opens it too.
 * Contract: specs/model-providers/model-cost-scoping.feature.
 */

import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Button,
  Card,
  Code,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Coins, MoreVertical, Plus } from "lucide-react";

import { modelProviderApi } from "../../behavior/model-provider-api.ts";
import { toLLMModelCostRow } from "../../model/llm-model-cost-row.ts";
import {
  MODEL_COST_MANAGE_PERMISSION,
  useModelProviderHost,
} from "../../model/model-provider-host.ts";

/**
 * One per-token rate, rendered at full precision. Rates run to nine decimal
 * places, so the default number formatting would round several of them to zero.
 */
function RateCell({ rate, isCustom }: { rate: number | undefined; isCustom: boolean }) {
  return (
    <Table.Cell padding={0}>
      <Text whiteSpace="nowrap" paddingX={3} color={isCustom ? "green.fg" : undefined}>
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
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Model Costs</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton
          primary
          data-testid="add-model-cost"
          onClick={() => host.openPlatformDrawer({ drawer: "llmModelCost" })}
          disabled={!host.hasPermission(MODEL_COST_MANAGE_PERMISSION)}
        >
          <Plus size={14} />
          Add New Model
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <VStack width="full" gap={6} align="start" paddingTop={4}>
        <Text color="fg.muted">
          {llmModelCosts.data
            ? `What each of the ${llmModelCosts.data.length} models costs per token.`
            : "What each model costs per token."}
        </Text>
        {llmModelCosts.data?.length === 0 ? (
          <NoDataInfoBlock
            title="No model costs"
            description="Add a model to set what it costs per token"
            icon={<Coins size={24} />}
          />
        ) : (
          <Card.Root width="full" overflow="hidden">
            <Card.Body padding={0} overflowX="auto">
              <Table.Root variant="line" width="full" maxWidth="100%">
                <Table.Header width="full">
                  <Table.Row width="full">
                    {/* Rates run to nine decimals: headers and values never wrap. */}
                    <Table.ColumnHeader minWidth="160px">Model name</Table.ColumnHeader>
                    <Table.ColumnHeader minWidth="160px">Regex match rule</Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">Input cost</Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">Output cost</Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">Cache read</Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">
                      Cache write (5 minutes)
                    </Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">
                      Cache write (1 hour)
                    </Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">Image input</Table.ColumnHeader>
                    <Table.ColumnHeader whiteSpace="nowrap">Image output</Table.ColumnHeader>
                    <Table.ColumnHeader width="64px" padding={1} />
                  </Table.Row>
                </Table.Header>
                <Table.Body width="full">
                  {llmModelCosts.isLoading &&
                    Array.from({ length: 3 }).map((_, rowIndex) => (
                      <Table.Row key={rowIndex}>
                        {Array.from({ length: 9 }).map((__, cellIndex) => (
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
                        <Text
                          truncate
                          maxWidth="220px"
                          color={row.updatedAt ? "green.fg" : undefined}
                        >
                          {row.model}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Code
                          truncate
                          maxWidth="220px"
                          color={row.updatedAt ? "green.fg" : undefined}
                        >
                          {row.regex}
                        </Code>
                      </Table.Cell>
                      <RateCell rate={row.inputCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.outputCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.cacheReadCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.cacheCreationCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.cacheCreation1hCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.inputImageCostPerToken} isCustom={!!row.id} />
                      <RateCell rate={row.outputImageCostPerToken} isCustom={!!row.id} />
                      <Table.Cell padding={1}>
                        <ActionsMenu id={row.id} model={row.model} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card.Body>
          </Card.Root>
        )}
      </VStack>
    </>
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
        <Button variant="ghost" size="sm" aria-label={`Actions for ${model}`}>
          <MoreVertical size={16} />
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
                    // The application already put a refusal on screen via a global
                    // interceptor; toasting again would say it twice. Nothing above
                    // a package-served screen holds that interceptor yet, so
                    // `isReportedGlobally` answers false and the toast is the outcome either way.
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
