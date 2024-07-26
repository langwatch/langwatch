import {
  Box,
  Button,
  Card,
  CardBody,
  Code,
  HStack,
  Heading,
  Input,
  Spacer,
  Table,
  Text,
  useToast,
  Thead,
  Tr,
  Th,
  Tbody,
  Td,
  TableContainer,
  InputGroup,
  InputLeftAddon,
  InputRightAddon,
} from "@chakra-ui/react";
import { Edit2, Plus } from "react-feather";
import React, { useCallback, useState } from "react";
import { api } from "../../utils/api";

function NewLLMModelCostForm({
  projectId,
  onNewModel,
}: {
  projectId: string;
  onNewModel: (model: {
    model: string;
    regex: string;
    inputCostPerToken: number;
    outputCostPerToken: number;
  }) => Promise<void>;
}) {
  const toast = useToast();
  const [newModel, setNewModel] = useState({
    model: "",
    regex: "",
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  });
  const createModel = api.llmModelCost.createModel.useMutation({
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create Custom LLM model.",
        status: "error",
        duration: 9000,
        isClosable: true,
      });
    },
    onSuccess: async () => {
      toast({
        title: "Success",
        description: `Model ${newModel.model} created successfully.`,
        status: "success",
        duration: 5000,
        isClosable: true,
      });
      await onNewModel(newModel);
    },
  });

  const handleCreateModel = useCallback(() => {
    if (!newModel.model) {
      toast({
        title: "Error",
        description: "Model name is required.",
        status: "error",
        duration: 9000,
        isClosable: true,
      });
      return;
    } else if (!newModel.regex) {
      toast({
        title: "Error",
        description: "Match rule is required.",
        status: "error",
        duration: 9000,
        isClosable: true,
      });
      return;
    } else if (newModel.inputCostPerToken < 0) {
      toast({
        title: "Error",
        description: "Input cost must be a positive number.",
        status: "error",
        duration: 9000,
        isClosable: true,
      });
      return;
    } else if (newModel.outputCostPerToken < 0) {
      toast({
        title: "Error",
        description: "Output cost must be a positive number.",
        status: "error",
        duration: 9000,
        isClosable: true,
      });
      return;
    } else {
      createModel.mutate({
        projectId: projectId,
        model: newModel.model,
        regex: newModel.regex,
        inputCostPerToken: newModel.inputCostPerToken,
        outputCostPerToken: newModel.outputCostPerToken,
      });
    }
  }, [createModel, newModel, projectId, toast]);

  return (
    <Tr>
      <Td>
        <Input
          placeholder="model name"
          defaultValue={newModel.model}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              model: e.target.value,
            }))
          }
        />
      </Td>
      <Td>
        <Input
          placeholder="match rule"
          defaultValue={newModel.regex}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              regex: e.target.value,
            }))
          }
        />
      </Td>
      <Td>
        <Input
          placeholder="input cost"
          defaultValue={newModel.inputCostPerToken}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              inputCostPerToken: Number(e.target.value),
            }))
          }
        />
      </Td>
      <Td>
        <Input
          placeholder="output cost"
          defaultValue={newModel.outputCostPerToken}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              outputCostPerToken: Number(e.target.value),
            }))
          }
        />
      </Td>
      <Td>
        <Button onClick={() => handleCreateModel()} colorScheme="orange">
          Save
        </Button>
      </Td>
    </Tr>
  );
}

export function LLMModelCost(props: { projectId?: string }) {
  const [showNewRow, setShowNewRow] = useState(false);

  const model = api.llmModelCost.getAllForProject.useQuery(
    { projectId: props.projectId ?? "" },
    { enabled: !!props.projectId }
  );
  const updateField = api.llmModelCost.updateField.useMutation({
    onSuccess: async () => {
      await model.refetch();
    },
  });
  const handleUpdateField = useCallback(
    (event: EditableField.SubmitEvent<any>) => {
      if (!event.id) return;

      updateField.mutate({
        projectId: props.projectId ?? "",
        model: event.model,
        field: event.fieldName as any,
        value:
          event.fieldName === "regex"
            ? String(event.value)
            : Number(event.value),
        id: event.id,
      });
    },
    [props.projectId, updateField]
  );

  const handleNewModel = useCallback(async () => {
    await model.refetch();
    setShowNewRow(false);
  }, [model, setShowNewRow]);

  return (
    <>
      <HStack width="full" marginTop={6}>
        <Heading size="md" as="h2">
          LLM Model Costs
        </Heading>
        <Text>·</Text>
        <Text fontSize="sm" color="gray.500">
          {model.data?.length} models
        </Text>
        <Spacer />
        <Button colorScheme="orange" onClick={() => setShowNewRow(!showNewRow)}>
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
                  <Th>Model name</Th>
                  <Th>Regex match rule</Th>
                  <Th>Input cost</Th>
                  <Th>Output cost</Th>
                  {showNewRow && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody width="full">
                {showNewRow && (
                  <NewLLMModelCostForm
                    projectId={props.projectId!}
                    onNewModel={handleNewModel}
                  />
                )}
                {model.data?.map((row) => (
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
                      <EditableField
                        id={row.id}
                        onSubmit={handleUpdateField}
                        model={row.model}
                        value={String(row.regex)}
                        name="regex"
                        renderValue={(value) => (
                          <HStack maxWidth="100%">
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
                              ^{value}$
                            </Code>
                          </HStack>
                        )}
                      />
                    </Td>
                    <Td padding={0}>
                      <EditableField
                        onSubmit={handleUpdateField}
                        model={row.model}
                        name="inputCostPerToken"
                        value={row.inputCostPerToken?.toLocaleString(
                          "fullwide",
                          {
                            useGrouping: false,
                            maximumSignificantDigits: 20,
                          }
                        )}
                        renderValue={(value) => (
                          <Text color={!!row.updatedAt ? "green.500" : void 0}>
                            {value}
                          </Text>
                        )}
                      />
                    </Td>
                    <Td padding={0}>
                      <EditableField
                        onSubmit={handleUpdateField}
                        model={row.model}
                        name="outputCostPerToken"
                        value={row.outputCostPerToken?.toLocaleString(
                          "fullwide",
                          {
                            useGrouping: false,
                            maximumSignificantDigits: 20,
                          }
                        )}
                        renderValue={(value) => (
                          <Text color={!!row.updatedAt ? "green.500" : void 0}>
                            {value}
                          </Text>
                        )}
                      />
                    </Td>
                    {showNewRow && <Td></Td>}
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

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace EditableField {
  export interface SubmitEvent<V> {
    value: V;
    fieldName: string;
    model: string;
    id?: string;
  }
  export interface Props<V> {
    value: V;
    name: string;
    model: string;
    renderValue: (value: V) => React.ReactNode;
    onSubmit?: (event: SubmitEvent<V>) => void;
    id?: string;
  }

  export type State = "viewing" | "editing" | "saving";
}

function EditableField<V>({
  value,
  onSubmit,
  name,
  model,
  renderValue,
  id,
}: EditableField.Props<V>) {
  const [state, setState] = useState<EditableField.State>("viewing");
  const [valueState, setValueState] = useState<V>(value);

  const isEditing = state === "editing";
  const isViewing = state === "viewing";

  const handleState = useCallback(() => {
    setState((prevState) => {
      if (prevState === "viewing") {
        return "editing";
      }
      return "viewing";
    });
  }, [setState]);

  const handleBlur = useCallback(() => {
    setState("viewing");
  }, [setState]);

  const handleInputValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValueState(e.target.value as any);
    },
    [setValueState]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        setState("viewing");
        if (onSubmit && valueState !== value) {
          onSubmit({
            value: valueState,
            fieldName: name,
            model: model,
            id: id,
          });
        }
      } else if (e.key === "Escape") {
        setValueState(value);
        setState("viewing");
      }
    },
    [onSubmit, valueState, value, name, model, id]
  );

  return (
    <HStack
      justifyContent="space-between"
      className="editable"
      paddingX={4}
      marginX={2}
      onClick={handleState}
    >
      {isEditing && (
        <InputGroup>
          <InputLeftAddon>^</InputLeftAddon>
          <Input
            name={name}
            autoFocus={true}
            defaultValue={valueState !== undefined ? String(valueState) : ""}
            onBlur={handleBlur}
            onChange={handleInputValueChange}
            onKeyDown={handleKeyDown}
          />
          <InputRightAddon>$</InputRightAddon>
        </InputGroup>
      )}
      {isViewing && renderValue(valueState)}
      {isViewing && (
        <Box
          visibility="hidden"
          sx={{
            ".editable:hover & ": {
              visibility: "visible",
            },
          }}
        >
          <Edit2 size={16} />
        </Box>
      )}
    </HStack>
  );
}
