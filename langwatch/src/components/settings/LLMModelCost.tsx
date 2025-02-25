import {
  Button,
  Card,
  Code,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Table,
  Text,
} from "@chakra-ui/react";
import { MoreVertical, Plus } from "react-feather";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { api } from "../../utils/api";
import { useDrawer } from "../CurrentDrawer";

export function LLMModelCost(props: { projectId?: string }) {
  const { openDrawer } = useDrawer();
  const llmModelCosts = api.llmModelCost.getAllForProject.useQuery(
    { projectId: props.projectId ?? "" },
    { enabled: !!props.projectId }
  );

  return (
    <>
      <HStack width="full" marginTop={6}>
        <Heading size="lg" as="h1" marginTop="-2px">
          LLM Model Costs
        </Heading>
        {llmModelCosts.data && (
          <>
            <Text fontSize="md">·</Text>
            <Text fontSize="md" color="gray.500">
              {llmModelCosts.data?.length} models
            </Text>
          </>
        )}
        <Spacer />
        <Button
          size="md"
          colorPalette="orange"
          onClick={() => openDrawer("llmModelCost", {})}
        >
          <Plus size={20} />
          <Text>Add New Model</Text>
        </Button>
      </HStack>
      <Text>
        The cost per token will be calculated according to this table on the
        first matching regex. You can override existing models or add new ones
        here.
      </Text>
      <Card.Root width="full">
        <Card.Body width="full" paddingY={0} paddingX={0}>
          <Table.Root
            variant="line"
            width="full"
            maxWidth="100%"
            wordBreak="break-all"
            style={{ tableLayout: "fixed" }}
          >
            <Table.Header width="full">
              <Table.Row width="full">
                <Table.ColumnHeader width="30%">Model name</Table.ColumnHeader>
                <Table.ColumnHeader width="30%">
                  Regex match rule
                </Table.ColumnHeader>
                <Table.ColumnHeader>Input cost</Table.ColumnHeader>
                <Table.ColumnHeader>Output cost</Table.ColumnHeader>
                <Table.ColumnHeader
                  width="64px"
                  padding={1}
                ></Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body width="full">
              {llmModelCosts.isLoading &&
                Array.from({ length: 3 }).map((_, index) => (
                  <Table.Row key={index}>
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Table.Cell key={index}>
                        <Skeleton height="20px" />
                      </Table.Cell>
                    ))}
                    <Table.Cell padding={1}></Table.Cell>
                  </Table.Row>
                ))}
              {llmModelCosts.data?.map((row) => (
                <Table.Row key={row.model} width="full">
                  <Table.Cell>
                    <Text
                      truncate
                      color={!!row.updatedAt ? "green.500" : undefined}
                    >
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
                        border="1px solid #EEE"
                        background="gray.50"
                        paddingY={1}
                        paddingX={2}
                      >
                        {row.regex}
                      </Code>
                    </HStack>
                  </Table.Cell>
                  <Table.Cell padding={0}>
                    <Text
                      justifyContent="space-between"
                      paddingX={4}
                      marginX={2}
                      color={!!row.id ? "green.500" : undefined}
                    >
                      {row.inputCostPerToken?.toLocaleString("fullwide", {
                        useGrouping: false,
                        maximumSignificantDigits: 20,
                      })}
                    </Text>
                  </Table.Cell>
                  <Table.Cell padding={0}>
                    <Text
                      justifyContent="space-between"
                      paddingX={4}
                      marginX={2}
                      color={!!row.id ? "green.500" : undefined}
                    >
                      {row.outputCostPerToken?.toLocaleString("fullwide", {
                        useGrouping: false,
                        maximumSignificantDigits: 20,
                      })}
                    </Text>
                  </Table.Cell>
                  <Table.Cell padding={1}>
                    <ActionsMenu
                      id={row.id}
                      model={row.model}
                      projectId={row.projectId}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card.Body>
      </Card.Root>
    </>
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
    { enabled: !!projectId }
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
                      meta: {
                        closable: true,
                      },
                      placement: "top-end",
                    });
                    void llmModelCosts.refetch();
                  },
                  onError: () => {
                    toaster.create({
                      title: "Error",
                      description: "Error deleting LLM model cost",
                      type: "error",
                      meta: {
                        closable: true,
                      },
                      placement: "top-end",
                    });
                  },
                }
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
