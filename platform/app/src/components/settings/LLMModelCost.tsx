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
import { MoreVertical, Plus } from "react-feather";
import { useDrawer } from "~/hooks/useDrawer";
import { Menu } from "@langwatch/design-system/menu";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { isHandledByGlobalHandler } from "../../utils/trpcError";
import { PageLayout } from "../ui/layouts/PageLayout";
import { toLLMModelCostRow } from "./llmModelCostRow";

/**
 * One per-token rate, rendered at full precision. Rates run to nine decimal
 * places, so the default number formatting would round several of them to
 * zero. Green marks a rate that comes from a stored cost rule, at whatever
 * scope, rather than from the model catalog.
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

export function LLMModelCost(props: { projectId?: string }) {
  const { openDrawer } = useDrawer();
  const { hasPermission } = useOrganizationTeamProject();
  const llmModelCosts = api.llmModelCost.getAllForProject.useQuery(
    { projectId: props.projectId ?? "" },
    { enabled: !!props.projectId },
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
                {llmModelCosts.data?.length} models
              </Text>
            </>
          )}
        </HStack>
        <Spacer />
        <PageLayout.HeaderButton
          onClick={() => openDrawer("llmModelCost", {})}
          disabled={!hasPermission("project:manage")}
        >
          <Plus size={20} />
          <Text>Add New Model</Text>
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <VStack
        width="full"
        gap={0}
        align="start"
        paddingY={4}
        paddingX={4}
        paddingBottom={12}
      >
        <Table.Root
          variant="line"
          width="full"
          maxWidth="100%"
          wordBreak="break-all"
          style={{ tableLayout: "fixed" }}
        >
          <Table.Header width="full">
            <Table.Row width="full">
              {/* The five rate columns share what these two leave. A rate runs
                  to nine decimal places and breaks mid-number when its column
                  is narrow, so the identifying columns give up some width to
                  keep the prices readable. */}
              <Table.ColumnHeader width="18%">Model name</Table.ColumnHeader>
              <Table.ColumnHeader width="18%">Regex match rule</Table.ColumnHeader>
              <Table.ColumnHeader>Input cost</Table.ColumnHeader>
              <Table.ColumnHeader>Output cost</Table.ColumnHeader>
              <Table.ColumnHeader>Cache read</Table.ColumnHeader>
              <Table.ColumnHeader>Cache write (5 minutes)</Table.ColumnHeader>
              <Table.ColumnHeader>Cache write (1 hour)</Table.ColumnHeader>
              <Table.ColumnHeader width="64px" padding={1}></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body width="full">
            {llmModelCosts.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Table.Row key={index}>
                  {Array.from({ length: 7 }).map((_, index) => (
                    <Table.Cell key={index}>
                      <Skeleton height="20px" />
                    </Table.Cell>
                  ))}
                  <Table.Cell padding={1}></Table.Cell>
                </Table.Row>
              ))}
            {llmModelCosts.data?.map(toLLMModelCostRow).map((row) => (
              <Table.Row key={row.model} width="full">
                <Table.Cell>
                  <Text truncate color={!!row.updatedAt ? "green.500" : undefined}>
                    {row.model}
                  </Text>
                </Table.Cell>
                <Table.Cell padding={0}>
                  <HStack
                    justifyContent="space-between"
                    paddingX={4}
                    marginX={2}
                    maxWidth="100%"
                  >
                    <Code
                      truncate
                      color={!!row.updatedAt ? "green.500" : undefined}
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
                  <ActionsMenu id={row.id} model={row.model} projectId={row.projectId} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </VStack>
    </VStack>
  );
}

function ActionsMenu({
  id,
  model,
  projectId,
}: {
  id?: string;
  model: string;
  projectId?: string;
}) {
  const { openDrawer } = useDrawer();
  const llmModelCosts = api.llmModelCost.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const deleteLLMModelCost = api.llmModelCost.delete.useMutation();

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

              openDrawer("llmModelCost", {
                cloneModel: model,
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

              openDrawer("llmModelCost", {
                id: id,
              });
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
                {
                  projectId: projectId ?? "",
                  id: id,
                },
                {
                  onSuccess: () => {
                    toaster.create({
                      title: "Success",
                      description: `LLM model cost deleted successfully`,
                      type: "success",
                    });
                    void llmModelCosts.refetch();
                  },
                  onError: (error) => {
                    if (isHandledByGlobalHandler(error)) return;
                    toaster.create({
                      title: "Error",
                      description: "Error deleting LLM model cost",
                      type: "error",
                    });
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
