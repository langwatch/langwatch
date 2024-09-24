import {
  Box,
  Button,
  FormControl,
  FormErrorMessage,
  HStack,
  Input,
  Select,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useUpdateNodeInternals, type Node } from "@xyflow/react";
import React, { useState } from "react";
import { ChevronDown, Columns, Plus, Trash2, X } from "react-feather";
import { useFieldArray, useForm } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type {
  Component,
  ComponentType,
  Field,
  Workflow,
} from "../../types/dsl";
import { ComponentIcon } from "../ColorfulBlockIcons";
import {
  ComponentExecutionButton,
  getNodeDisplayName,
  isExecutableComponent,
  NodeSectionTitle,
  TypeLabel,
} from "../nodes/Nodes";

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

export function PropertyFields({
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

  const { fields, append, remove } = useFieldArray({
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

  const watchedFields = watch("fields");

  return (
    <VStack
      as="form"
      align="start"
      spacing={3}
      width="full"
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
      {fields.map((field, index) => {
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
            key={field.id}
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
                    fontSize={14}
                    border="none"
                    background="transparent"
                    padding="6px 0px 6px 12px"
                  />
                ) : (
                  <Text
                    fontFamily="monospace"
                    fontSize={14}
                    width="full"
                    padding="8px 0px 8px 12px"
                  >
                    {field.identifier}
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
                        <option value="float">float</option>
                        <option value="int">int</option>
                        <option value="bool">bool</option>
                        <option value="list[str]">list[str]</option>
                        <option value="list[float]">list[float]</option>
                        <option value="list[int]">list[int]</option>
                        <option value="list[bool]">list[bool]</option>
                        <option value="dict">dict</option>
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

export function PropertySectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Box paddingLeft={2}>
      <NodeSectionTitle fontSize={13}>{children}</NodeSectionTitle>
    </Box>
  );
}

export function BasePropertiesPanel({
  node,
  header,
  children,
  fieldsAfter,
  inputsReadOnly,
  outputsTitle,
  outputsReadOnly,
}: {
  node: Node<Component> | Workflow;
  header?: React.ReactNode;
  children?: React.ReactNode;
  fieldsAfter?: React.ReactNode;
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
    setNode(
      {
        id: id,
        data: {
          name: value,
        },
      },
      name
    );
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
    >
      <HStack paddingY={1} paddingLeft={2} width="full" justify="space-between">
        <HStack spacing={3}>
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
                  fontSize={16}
                  marginLeft={1}
                  fontWeight={500}
                  width="190px"
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
                <Text
                  fontSize={16}
                  fontWeight={500}
                  onClick={() => setIsEditingName(true)}
                >
                  {getNodeDisplayName(node)}
                </Text>
              )}
            </>
          ) : null}
        </HStack>
        <Spacer />
        <HStack spacing={0} marginRight="-4px">
          {!isWorkflow(node) && isExecutableComponent(node) && (
            <>
              <HStack
                spacing={3}
                onClick={() => {
                  setPropertiesExpanded(!propertiesExpanded);
                }}
              >
                <ComponentExecutionButton
                  node={node}
                  size="sm"
                  iconSize={16}
                  componentOnly={propertiesExpanded}
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
      {children}
      {!isWorkflow(node) && (
        <>
          {/* <PropertyFields node={node} field="parameters" title="Parameters" /> */}
          <PropertyFields
            node={node}
            field="inputs"
            title="Inputs"
            readOnly={inputsReadOnly}
          />
          <PropertyFields
            node={node}
            field="outputs"
            title={outputsTitle ?? "Outputs"}
            readOnly={outputsReadOnly}
          />
        </>
      )}
      {fieldsAfter}
    </VStack>
  );
}
