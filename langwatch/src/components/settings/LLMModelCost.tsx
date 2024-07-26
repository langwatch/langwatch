import {
  Button,
  Card,
  CardBody,
  Code,
  HStack,
  Heading,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Skeleton,
  Spacer,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useToast,
} from "@chakra-ui/react";
import { MoreVertical, Plus } from "react-feather";
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
          colorScheme="orange"
          onClick={() => openDrawer("llmModelCost", {})}
        >
          <HStack spacing={2}>
            <Plus size={20} />
            <Text>Add New Model</Text>
          </HStack>
        </Button>
      </HStack>
      <Text>
        The cost per token will be calculated according to this table on the
        first matching regex. You can override existing models or add new ones
        here.
      </Text>
      <Card width="full">
        <CardBody width="full" paddingY={0} paddingX={0}>
          <TableContainer>
            <Table
              variant="simple"
              width="full"
              maxWidth="100%"
              wordBreak="break-all"
              style={{ tableLayout: "fixed" }}
            >
              <Thead width="full">
                <Tr width="full">
                  <Th width="30%">Model name</Th>
                  <Th width="30%">Regex match rule</Th>
                  <Th>Input cost</Th>
                  <Th>Output cost</Th>
                  <Th width="64px" padding={1}></Th>
                </Tr>
              </Thead>
              <Tbody width="full">
                {llmModelCosts.isLoading &&
                  Array.from({ length: 3 }).map((_, index) => (
                    <Tr key={index}>
                      {Array.from({ length: 4 }).map((_, index) => (
                        <Td key={index}>
                          <Skeleton height="20px" />
                        </Td>
                      ))}
                      <Td padding={1}></Td>
                    </Tr>
                  ))}
                {llmModelCosts.data?.map((row) => (
                  <Tr key={row.model} width="full">
                    <Td>
                      <Text
                        isTruncated
                        color={!!row.updatedAt ? "green.500" : void 0}
                      >
                        {row.model}
                      </Text>
                    </Td>
                    <Td padding={0}>
                      <HStack
                        justifyContent="space-between"
                        paddingX={4}
                        marginX={2}
                        maxWidth="100%"
                      >
                        <Code
                          isTruncated
                          color={!!row.updatedAt ? "green.500" : void 0}
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
                    </Td>
                    <Td padding={0}>
                      <Text
                        justifyContent="space-between"
                        paddingX={4}
                        marginX={2}
                        color={!!row.id ? "green.500" : void 0}
                      >
                        {row.inputCostPerToken?.toLocaleString("fullwide", {
                          useGrouping: false,
                          maximumSignificantDigits: 20,
                        })}
                      </Text>
                    </Td>
                    <Td padding={0}>
                      <Text
                        justifyContent="space-between"
                        paddingX={4}
                        marginX={2}
                        color={!!row.id ? "green.500" : void 0}
                      >
                        {row.outputCostPerToken?.toLocaleString("fullwide", {
                          useGrouping: false,
                          maximumSignificantDigits: 20,
                        })}
                      </Text>
                    </Td>
                    <Td padding={1}>
                      <ActionsMenu
                        id={row.id}
                        model={row.model}
                        projectId={row.projectId}
                      />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </CardBody>
      </Card>
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
  const toast = useToast();
  const deleteLLMModelCost = api.llmModelCost.delete.useMutation();

  return (
    <Menu>
      <MenuButton as={Button} variant={"ghost"} minWidth={0}>
        <MoreVertical />
      </MenuButton>
      <MenuList>
        {!id && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();

              openDrawer("llmModelCost", {
                cloneModel: model,
              });
            }}
          >
            Clone
          </MenuItem>
        )}
        {id && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();

              openDrawer("llmModelCost", {
                id: id,
              });
            }}
          >
            Edit
          </MenuItem>
        )}
        {id && (
          <MenuItem
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
                    toast({
                      title: "Success",
                      description: `LLM model cost deleted successfully`,
                      status: "success",
                      duration: 5000,
                      isClosable: true,
                      position: "top-right",
                    });
                    void llmModelCosts.refetch();
                  },
                  onError: () => {
                    toast({
                      title: "Error",
                      description: "Error deleting LLM model cost",
                      status: "error",
                      duration: 5000,
                      isClosable: true,
                      position: "top-right",
                    });
                  },
                }
              );
            }}
          >
            Delete
          </MenuItem>
        )}
      </MenuList>
    </Menu>
  );
}
