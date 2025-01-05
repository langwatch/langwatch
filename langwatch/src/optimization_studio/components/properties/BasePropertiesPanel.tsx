import {
  Box,
  Button,
  Center,
  FormControl,
  FormErrorMessage,
  HStack,
  Input,
  Select,
  Spacer,
  Text,
  Tooltip,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useUpdateNodeInternals, type Node } from "@xyflow/react";
import React, { useEffect, useState } from "react";
import {
  ChevronDown,
  Columns,
  Edit2,
  Info,
  Plus,
  Trash2,
  X,
} from "react-feather";
import { useFieldArray, useForm } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";

import { HoverableBigText } from "../../../components/HoverableBigText";
import { camelCaseToTitleCase } from "../../../utils/stringCasing";
import type {
  Component,
  ComponentType,
  Field,
  LLMConfig,
  Workflow,
} from "../../types/dsl";
import { nameToId } from "../../utils/nodeUtils";
import { ComponentIcon } from "../ColorfulBlockIcons";
import {
  ComponentExecutionButton,
  getNodeDisplayName,
  isExecutableComponent,
  NodeSectionTitle,
  TypeLabel,
} from "../nodes/Nodes";

import { LLMConfigField } from "./modals/LLMConfigModal";
import { RenderCode } from "../../../components/code/RenderCode";
import { CodeEditorModal } from "../code/CodeEditorModal";

export function PropertyField({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VStack align="start" spacing={3} width="full">
      <PropertySectionTitle>{title}</PropertySectionTitle>
      {children}
    </VStack>
  );
}

type FieldArrayForm = {
  fields: Field[];
};

export function FieldsDefinition({
  node,
  title,
  field,
  readOnly = false,
}: {
  node: Node<Component>;
  title: string;
  field: "parameters" | "inputs" | "outputs";
  readOnly?: boolean;
}) {
  const { setNode } = useWorkflowStore(
    useShallow((state) => ({
      setNode: state.setNode,
    }))
  );
  const {
    control,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FieldArrayForm>({
    defaultValues: {
      fields: node.data[field] ?? [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "fields",
  });

  const updateNodeInternals = useUpdateNodeInternals();

  const onSubmit = (data: FieldArrayForm) => {
    setNode({
      id: node.id,
      data: { [field]: data.fields },
    });
    updateNodeInternals(node.id);
  };

  useEffect(() => {
    const currentFields = node.data[field] ?? [];
    replace(currentFields);

    setTimeout(() => {
      updateNodeInternals(node.id);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.data.behave_as]);

  const watchedFields = watch("fields");

  return (
    <VStack
      as="form"
      align="start"
      spacing={3}
      width="full"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={handleSubmit(onSubmit)}
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onChange={handleSubmit(onSubmit)}
    >
      <HStack width="full">
        <PropertySectionTitle>{title}</PropertySectionTitle>
        <Spacer />
        {!readOnly ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => append({ identifier: "", type: "str" })}
          >
            <Plus size={16} />
          </Button>
        ) : null}
      </HStack>
      {fields.map((field_, index) => {
        const identifierField = control.register(`fields.${index}.identifier`, {
          required: "Required",
          pattern: {
            value: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
            message: "Only letters, numbers, and underscores are allowed",
          },
          validate: (value) => {
            const identifiers = control._formValues.fields.map(
              (f: Field) => f.identifier
            );
            return (
              identifiers.filter((id: string) => id === value).length === 1 ||
              "Duplicate identifier"
            );
          },
        });

        return (
          <FormControl
            key={field_.id}
            isInvalid={!!errors.fields?.[index]?.identifier}
          >
            <HStack width="full">
              <HStack
                background="gray.100"
                paddingRight={2}
                borderRadius="8px"
                width="full"
              >
                {!readOnly ? (
                  <Input
                    {...identifierField}
                    onChange={(e) => {
                      e.target.value = e.target.value
                        .replace(/ /g, "_")
                        .toLowerCase();
                      void identifierField.onChange(e);
                    }}
                    width="full"
                    fontFamily="monospace"
                    fontSize={13}
                    border="none"
                    background="transparent"
                    padding="6px 0px 6px 12px"
                  />
                ) : (
                  <Text
                    fontFamily="monospace"
                    fontSize={13}
                    width="full"
                    padding="8px 0px 8px 12px"
                  >
                    {field_.identifier}
                  </Text>
                )}
                <HStack
                  position="relative"
                  background="white"
                  borderRadius="8px"
                  paddingX={2}
                  paddingY={1}
                  spacing={2}
                  height="full"
                >
                  <Box fontSize={13}>
                    <TypeLabel type={watchedFields[index]?.type ?? ""} />
                  </Box>
                  {!readOnly ? (
                    <>
                      <Box color="gray.600">
                        <ChevronDown size={14} />
                      </Box>
                      <Select
                        {...control.register(`fields.${index}.type`)}
                        opacity={0}
                        position="absolute"
                        top={0}
                        left={0}
                        width="100%"
                        height="32px"
                        icon={<></>}
                      >
                        <option value="str">str</option>
                        {field === "inputs" && (
                          <option value="image">image</option>
                        )}
                        <option value="float">float</option>

                        <option value="bool">bool</option>
                        {/* <option value="int">int</option>
                        <option value="list[str]">list[str]</option>
                        <option value="list[float]">list[float]</option>
                        <option value="list[int]">list[int]</option>
                        <option value="list[bool]">list[bool]</option>
                        <option value="dict">dict</option> */}
                      </Select>
                    </>
                  ) : null}
                </HStack>
              </HStack>
              {!readOnly ? (
                <Button
                  colorScheme="gray"
                  size="sm"
                  height="40px"
                  onClick={() => {
                    remove(index);
                    void handleSubmit(onSubmit)();
                  }}
                  isDisabled={fields.length === 1}
                >
                  <Trash2 size={18} />
                </Button>
              ) : null}
            </HStack>
            <FormErrorMessage>
              {errors.fields?.[index]?.identifier?.message}
            </FormErrorMessage>
          </FormControl>
        );
      })}
    </VStack>
  );
}

export function FieldsForm({
  node,
  title,
  field,
}: {
  node: Node<Component>;
  title: string;
  field: "parameters" | "inputs" | "outputs";
}) {
  const { default_llm, setNode, parameters, setNodeParameter } =
    useWorkflowStore(
      useShallow((state) => ({
        parameters: state.nodes.find((n) => n.id === node.id)?.data.parameters,
        setNode: state.setNode,
        default_llm: state.default_llm,
        setNodeParameter: state.setNodeParameter,
      }))
    );

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FieldArrayForm>({
    defaultValues: {
      fields: node.data[field] ?? [],
    },
  });

  const { fields } = useFieldArray({
    control,
    name: "fields",
  });

  const updateNodeInternals = useUpdateNodeInternals();
  const onSubmit = (data: FieldArrayForm) => {
    setNode({
      id: node.id,
      data: { [field]: data.fields },
    });
    updateNodeInternals(node.id);
  };

  const codeEditorModal = useDisclosure();

  return (
    <VStack
      as="form"
      align="start"
      spacing={3}
      width="full"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onChange={handleSubmit(onSubmit)}
    >
      {fields.map((field, index) => {
        if (field.type === "llm") {
          return (
            <LLMConfigField
              key={field.id}
              allowDefault={true}
              defaultLLMConfig={default_llm}
              llmConfig={node.data.parameters?.[index]?.value as LLMConfig}
              onChange={(llmConfig) => {
                setNode({
                  id: node.id,
                  data: {
                    parameters: node.data.parameters?.map((p) =>
                      p.identifier === field.identifier
                        ? { ...p, value: llmConfig }
                        : p
                    ),
                  },
                });
                updateNodeInternals(node.id);
              }}
            />
          );
        }

        if (field.type === "code") {
          const stateField = parameters?.find(
            (p) => p.identifier === field.identifier
          );
          return (
            <Box position="relative" width="full" key={field.id}>
              <Center
                role="button"
                aria-label="Edit code"
                onClick={codeEditorModal.onOpen}
                position="absolute"
                top={0}
                left={0}
                width="100%"
                height="100%"
                background="rgba(0, 0, 0, 0.2)"
                zIndex={10}
                opacity={0}
                cursor="pointer"
                transition="opacity 0.2s ease-in-out"
                _hover={{
                  opacity: 1,
                }}
              >
                <HStack
                  spacing={2}
                  fontSize={18}
                  fontWeight="bold"
                  color="white"
                  background="rgba(0, 0, 0, .5)"
                  paddingY={2}
                  paddingX={4}
                  borderRadius="6px"
                >
                  <Edit2 size={20} />
                  <Text>Edit</Text>
                </HStack>
              </Center>
              <RenderCode
                code={stateField?.value as string}
                language="python"
                style={{
                  width: "100%",
                  fontSize: "12px",
                  padding: "12px",
                  borderRadius: "8px",
                  backgroundColor: "rgb(39, 40, 34)",
                  maxHeight: "200px",
                  overflowY: "hidden",
                }}
              />
              <CodeEditorModal
                code={stateField?.value as string}
                setCode={(code) => {
                  setNodeParameter(node.id, {
                    identifier: field.identifier,
                    type: "code",
                    value: code,
                  });
                }}
                isOpen={codeEditorModal.isOpen}
                onClose={codeEditorModal.onClose}
              />
            </Box>
          );
        }

        return (
          <FormControl
            key={field.id}
            isInvalid={!!errors.fields?.[index]?.identifier}
          >
            <VStack align="start" spacing={3} width="full">
              <HStack width="full">
                <PropertySectionTitle>
                  {camelCaseToTitleCase(field.identifier)}
                </PropertySectionTitle>
                {field.optional && (
                  <Text color="gray.500" fontSize={12}>
                    (optional)
                  </Text>
                )}
                {field.desc && (
                  <Tooltip label={field.desc}>
                    <Info size={14} />
                  </Tooltip>
                )}
              </HStack>
              <HStack width="full">
                {field.type === "float" || field.type === "int" ? (
                  <Input
                    type="number"
                    step={field.type === "float" ? "0.1" : undefined}
                    size="sm"
                    {...control.register(`fields.${index}.value`)}
                  />
                ) : (
                  <Input
                    type="text"
                    size="sm"
                    {...control.register(`fields.${index}.value`)}
                  />
                )}
              </HStack>
              <FormErrorMessage>
                {errors.fields?.[index]?.identifier?.message}
              </FormErrorMessage>
            </VStack>
          </FormControl>
        );
      })}
    </VStack>
  );
}

export function PropertySectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box paddingLeft={2}>
      <NodeSectionTitle fontSize={12}>{children}</NodeSectionTitle>
    </Box>
  );
}

export function BasePropertiesPanel({
  node,
  header,
  children,
  fieldsAfter,
  hideParameters,
  hideInputs,
  inputsTitle,
  hideOutputs,
  inputsReadOnly,
  outputsTitle,
  outputsReadOnly,
}: {
  node: Node<Component> | Workflow;
  header?: React.ReactNode;
  children?: React.ReactNode;
  fieldsAfter?: React.ReactNode;
  hideParameters?: boolean;
  hideInputs?: boolean;
  inputsTitle?: string;
  hideOutputs?: boolean;
  inputsReadOnly?: boolean;
  outputsTitle?: string;
  outputsReadOnly?: boolean;
}) {
  const {
    deselectAllNodes,
    propertiesExpanded,
    setPropertiesExpanded,
    setNode,
  } = useWorkflowStore(
    useShallow((state) => ({
      deselectAllNodes: state.deselectAllNodes,
      propertiesExpanded: state.propertiesExpanded,
      setPropertiesExpanded: state.setPropertiesExpanded,
      setNode: state.setNode,
    }))
  );

  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState<string | undefined>(undefined);

  const isWorkflow = (node: Node<Component> | Workflow): node is Workflow =>
    !("data" in node);

  const handleNameChange = (value: string, id: string) => {
    const newId = nameToId(value);
    setNode({ id, data: { name: value } }, newId);
  };

  return (
    <VStack
      align="start"
      spacing={6}
      padding={3}
      maxWidth="550px"
      width="25vw"
      minWidth="350px"
      height="full"
      overflowY="auto"
    >
      <VStack spacing={2} width="full" align="start">
        <HStack
          paddingY={1}
          paddingLeft={2}
          width="full"
          justify="space-between"
          spacing={0}
          alignItems="flex-start"
        >
          <HStack spacing={2}>
            {header ? (
              header
            ) : !isWorkflow(node) ? (
              <>
                <ComponentIcon
                  type={node.type as ComponentType}
                  cls={node.data.cls}
                  size="lg"
                />
                {isEditingName ? (
                  <Input
                    fontSize={15}
                    marginLeft={1}
                    fontWeight={500}
                    variant="outline"
                    background="transparent"
                    value={name ?? getNodeDisplayName(node)}
                    borderRadius={5}
                    paddingLeft={1}
                    margin={0}
                    size="sm"
                    onBlur={() => {
                      setIsEditingName(false);
                      if (name) {
                        handleNameChange(name, node.id);
                      }
                    }}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setIsEditingName(false);
                        if (name) {
                          handleNameChange(name, node.id);
                        }
                      }
                    }}
                  />
                ) : (
                  <HoverableBigText
                    noOfLines={2}
                    fontSize={15}
                    fontWeight={500}
                    onClick={() => {
                      if (node.type !== "prompting_technique") {
                        setIsEditingName(true);
                      }
                    }}
                    cursor={
                      node.type === "prompting_technique"
                        ? undefined
                        : "pointer"
                    }
                    overflow="hidden"
                    textOverflow="ellipsis"
                  >
                    {getNodeDisplayName(node)}
                  </HoverableBigText>
                )}
              </>
            ) : null}
          </HStack>
          <HStack spacing={0} marginRight="-4px" hidden={isEditingName}>
            {!isWorkflow(node) && isExecutableComponent(node) && (
              <>
                <HStack
                  spacing={2}
                  onClick={() => {
                    if (!propertiesExpanded) {
                      setPropertiesExpanded(true);
                    }
                  }}
                >
                  <ComponentExecutionButton
                    node={node}
                    size="sm"
                    iconSize={16}
                  />
                </HStack>

                <Button
                  variant="ghost"
                  size="sm"
                  color="gray.500"
                  onClick={() => {
                    setPropertiesExpanded(!propertiesExpanded);
                  }}
                >
                  <Columns size={16} />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              color="gray.500"
              onClick={() => {
                if (propertiesExpanded) {
                  setPropertiesExpanded(false);
                } else {
                  deselectAllNodes();
                }
              }}
            >
              <X size={16} />
            </Button>
          </HStack>
        </HStack>
        {node.data?.description && (
          <Text fontSize={12} color="gray.500" paddingX={2}>
            {node.data?.description}
          </Text>
        )}
      </VStack>
      {children}
      {!isWorkflow(node) && (
        <>
          {!hideParameters && (
            <FieldsForm node={node} field="parameters" title="Parameters" />
          )}

          {!hideInputs && (
            <FieldsDefinition
              node={node}
              field="inputs"
              title={inputsTitle ?? "Inputs"}
              readOnly={inputsReadOnly}
            />
          )}
          {!hideOutputs && (
            <FieldsDefinition
              node={node}
              field="outputs"
              title={outputsTitle ?? "Outputs"}
              readOnly={outputsReadOnly}
            />
          )}
        </>
      )}
      {fieldsAfter}
    </VStack>
  );
}
