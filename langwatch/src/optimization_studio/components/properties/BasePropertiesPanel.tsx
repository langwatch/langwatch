import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  type StackProps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Columns, Info, Plus, Trash2, X } from "react-feather";
import { useFieldArray, useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";
import { PropertySectionTitle } from "~/components/ui/PropertySectionTitle";
import { HoverableBigText } from "../../../components/HoverableBigText";
import { Tooltip } from "../../../components/ui/tooltip";
import { camelCaseToTitleCase } from "../../../utils/stringCasing";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type {
  Component,
  ComponentType,
  Field as FieldType,
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

import { OptimizationStudioLLMConfigField } from "./llm-configs/OptimizationStudioLLMConfigField";

export function PropertyField({
  title,
  children,
  tooltip,
}: {
  title: string;
  children: React.ReactNode;
  tooltip?: React.ReactNode;
}) {
  return (
    <VStack align="start" gap={3} width="full">
      <PropertySectionTitle tooltip={tooltip}>{title}</PropertySectionTitle>
      {children}
    </VStack>
  );
}

type FieldArrayForm = {
  fields: FieldType[];
};

export function FieldsDefinition({
  node,
  title,
  field,
  readOnly = false,
  onChange,
}: {
  node: Node<Component>;
  title: string;
  field: "parameters" | "inputs" | "outputs";
  readOnly?: boolean;
  onChange?: (data: FieldArrayForm) => void;
}) {
  const { setNode } = useWorkflowStore(
    useShallow((state) => ({
      setNode: state.setNode,
    })),
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
    onChange?.(data);
  };

  const handleOnChange = async (data: FieldArrayForm) => {
    onChange?.(data);
    // We are pretending to submit on every change
    onSubmit(data);
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
      gap={3}
      width="full"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={handleSubmit(onSubmit)}
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onChange={handleSubmit(handleOnChange)}
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
              (f: FieldType) => f.identifier,
            );
            return (
              identifiers.filter((id: string) => id === value).length === 1 ||
              "Duplicate identifier"
            );
          },
        });

        return (
          <Field.Root
            key={field_.id}
            invalid={!!errors.fields?.[index]?.identifier}
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
                    fontSize="13px"
                    border="none"
                    background="transparent"
                    padding="6px 0px 6px 12px"
                  />
                ) : (
                  <Text
                    fontFamily="monospace"
                    fontSize="13px"
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
                  gap={2}
                  height="full"
                >
                  <Box fontSize="13px">
                    <TypeLabel type={watchedFields[index]?.type ?? ""} />
                  </Box>
                  {!readOnly ? (
                    <>
                      <Box color="gray.600">
                        <ChevronDown size={14} />
                      </Box>
                      <NativeSelect.Root
                        position="absolute"
                        top={0}
                        left={0}
                        height="32px"
                        width="100%"
                        cursor="pointer"
                        zIndex={10}
                        opacity={0}
                      >
                        <NativeSelect.Field
                          {...control.register(`fields.${index}.type`)}
                        >
                          <option value="str">str</option>
                          {field === "inputs" && (
                            <option value="image">image</option>
                          )}
                          <option value="float">float</option>
                          <option value="bool">bool</option>
                          <option value="dict">dict</option>
                          <option value="list">list</option>
                        </NativeSelect.Field>
                      </NativeSelect.Root>
                    </>
                  ) : null}
                </HStack>
              </HStack>
              {!readOnly ? (
                <Button
                  colorPalette="gray"
                  size="sm"
                  height="40px"
                  onClick={() => {
                    remove(index);
                    void handleSubmit(onSubmit)();
                  }}
                  disabled={fields.length === 1}
                >
                  <Trash2 size={18} />
                </Button>
              ) : null}
            </HStack>
            <Field.ErrorText>
              {errors.fields?.[index]?.identifier?.message}
            </Field.ErrorText>
          </Field.Root>
        );
      })}
    </VStack>
  );
}

/**
 * FieldsForm - Form component for editing node parameters, inputs, or outputs
 *
 * Architecture:
 * - All UI updates flow through react-hook-form state first
 * - Form changes are watched and debounced before updating the node
 * - This prevents race conditions and ensures form state stays in sync
 *
 * Why form state instead of direct node updates?
 * - Prevents field resets when other fields change (e.g., LLM config resetting)
 * - Ensures all fields update atomically through form validation
 * - Debouncing reduces unnecessary node updates during rapid changes
 *
 * Data flow:
 * 1. User changes field → setValue() updates form state
 * 2. watch() detects form change → triggers debounced submit
 * 3. onSubmit() reads form state → updates node via setNode()
 *
 * @param node - The workflow node to edit
 * @param field - Which field array to edit: "parameters", "inputs", or "outputs"
 */
export function FieldsForm({
  node,
  field,
}: {
  node: Node<Component>;
  field: "parameters" | "inputs" | "outputs";
}) {
  const _parameters = node.data.parameters;
  const { default_llm, setNode } = useWorkflowStore(
    useShallow((state) => ({
      parameters: state.nodes.find((n) => n.id === node.id)?.data.parameters,
      setNode: state.setNode,
      default_llm: state.default_llm,
    })),
  );

  // Initialize form with current node data
  // Form state is the source of truth during editing
  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
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

  /**
   * onSubmit - Updates the node with form data
   * Called automatically when form values change (via watch subscription)
   */
  const onSubmit = useCallback(
    (data: FieldArrayForm) => {
      setNode({
        id: node.id,
        data: { [field]: data.fields },
      });
      updateNodeInternals(node.id);
    },
    [node.id, field, setNode, updateNodeInternals],
  );

  // Wrapper to handle async form submission
  const handleSubmit_ = useCallback(() => {
    void handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  /**
   * Debounced submit handler
   * - leading: true - Submit immediately on first change (responsive)
   * - trailing: false - Don't submit again after debounce period
   * - 100ms delay - Balances responsiveness with update frequency
   */
  const handleSubmitDebounced = useDebouncedCallback(handleSubmit_, 100, {
    leading: true,
    trailing: false,
  });

  /**
   * Watch form changes and auto-submit
   * This ensures any form update (via setValue, register, etc.) triggers node update
   * Subscription pattern allows cleanup when component unmounts
   */
  useEffect(() => {
    const subscription = watch(() => {
      handleSubmitDebounced();
    });

    return () => subscription.unsubscribe();
  }, [watch, handleSubmitDebounced]);

  return (
    <VStack as="form" align="start" gap={3} width="full">
      {fields.map((field, index) => {
        if (field.type === "llm") {
          return (
            <OptimizationStudioLLMConfigField
              key={field.id}
              allowDefault={true}
              defaultLLMConfig={default_llm}
              llmConfig={node.data.parameters?.[index]?.value as LLMConfig}
              onChange={(llmConfig) => {
                // Update form state instead of directly calling setNode
                // This ensures form state stays in sync and prevents resets
                // The watch() subscription will automatically trigger onSubmit
                setValue(`fields.${index}.value`, llmConfig, {
                  shouldValidate: true,
                });
              }}
            />
          );
        }

        // Skip code fields - they're handled by CodePropertiesPanel
        if (field.type === "code") {
          return null;
        }

        return (
          <Field.Root
            key={field.id}
            invalid={!!errors.fields?.[index]?.identifier}
          >
            <VStack align="start" gap={3} width="full">
              <HStack width="full">
                <PropertySectionTitle>
                  {camelCaseToTitleCase(field.identifier)}
                </PropertySectionTitle>
                {field.optional && (
                  <Text color="gray.500" fontSize="12px">
                    (optional)
                  </Text>
                )}
                {field.desc && (
                  <Tooltip content={field.desc}>
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
              <Field.ErrorText>
                {errors.fields?.[index]?.identifier?.message}
              </Field.ErrorText>
            </VStack>
          </Field.Root>
        );
      })}
    </VStack>
  );
}

// Re-export PropertySectionTitle for backwards compatibility
export {
  PropertySectionTitle,
  type PropertySectionTitleProps,
} from "~/components/ui/PropertySectionTitle";

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
  hideDescription,
  hideHeader,
  ...props
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
  hideDescription?: boolean;
  hideHeader?: boolean;
  maxWidth?: string;
} & StackProps) {
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
    })),
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
      gap={6}
      padding={3}
      maxWidth="550px"
      width="25vw"
      minWidth="350px"
      height="full"
      overflowY="auto"
      {...props}
    >
      {!hideHeader && (
        <VStack gap={2} width="full" align="start">
          <HStack
            paddingY={1}
            paddingLeft={2}
            width="full"
            justify="space-between"
            gap={0}
            alignItems="flex-start"
          >
            <HStack gap={2}>
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
                      fontSize="15px"
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
                      lineClamp={2}
                      fontSize="15px"
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
                      expandable={false}
                    >
                      {getNodeDisplayName(node)}
                    </HoverableBigText>
                  )}
                </>
              ) : null}
            </HStack>
            <HStack gap={0} marginRight="-4px" hidden={isEditingName}>
              {!isWorkflow(node) && isExecutableComponent(node) && (
                <>
                  <HStack
                    gap={2}
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
          {!hideDescription && node.data?.description && (
            <Text fontSize="12px" color="gray.500" paddingX={2}>
              {node.data?.description}
            </Text>
          )}
        </VStack>
      )}
      {children}
      {!isWorkflow(node) && (
        <>
          {!hideParameters && <FieldsForm node={node} field="parameters" />}

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
