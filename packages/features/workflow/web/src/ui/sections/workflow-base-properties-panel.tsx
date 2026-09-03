import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Menu,
  Spacer,
  type StackProps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Columns, Info, Plus, Trash2, X } from "react-feather";
import { useFieldArray, useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useInsideDrawer } from "../elements/studio-drawer-footer";
import { useWorkflowStore } from "../../behavior/use-workflow-store";
import type {
  Component,
  ComponentType,
  Field as FieldType,
  LLMConfig,
  StudioWorkflow,
} from "@langwatch/workflow-contract";
import {
  componentTypeSchema,
  llmConfigSchema,
  nameToId,
  validateNodeName,
} from "@langwatch/workflow-contract";
import { ComponentExecutionButton } from "./workflow-node-execution";
import { getNodeDisplayName, isExecutableComponent } from "./workflow-nodes";

export type WorkflowPropertySectionTitleProps = {
  children: ReactNode;
  tooltip?: ReactNode;
} & StackProps;

export function WorkflowPropertySectionTitle({
  children,
  tooltip,
  ...props
}: WorkflowPropertySectionTitleProps) {
  return (
    <HStack paddingLeft={2} {...props}>
      <Text fontSize="12px" fontWeight="bold" textTransform="uppercase" color="fg.muted">
        {children}
      </Text>
      {tooltip && (
        <Tooltip content={tooltip}>
          <Box marginBottom="-2px">
            <Info size={14} />
          </Box>
        </Tooltip>
      )}
    </HStack>
  );
}

const camelCaseToTitleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

type WorkflowFieldTypeOption = {
  value: FieldType["type"];
  label: string;
};

const workflowFieldTypeLabels: Partial<Record<FieldType["type"], string>> = {
  str: "Text",
  image: "Image",
  float: "Number",
  bool: "Boolean",
  dict: "Object",
  list: "List",
};

function WorkflowFieldTypeSelect({
  value,
  options,
  readOnly,
  onChange,
  testId,
}: {
  value: FieldType["type"];
  options: WorkflowFieldTypeOption[];
  readOnly: boolean;
  onChange: (value: FieldType["type"]) => void;
  testId: string;
}) {
  const label = workflowFieldTypeLabels[value] ?? value;

  if (readOnly) {
    return (
      <Text fontSize="13px" color="fg.muted" data-testid={testId}>
        {label}
      </Text>
    );
  }

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          colorPalette="gray"
          flexShrink={0}
          gap={1}
          paddingX={2}
          fontWeight="normal"
          data-testid={testId}
        >
          <Text fontSize="13px">{label}</Text>
        </Button>
      </Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content borderRadius="lg" background="bg.panel">
          {options.map((option) => (
            <Menu.Item
              key={option.value}
              value={option.value}
              onClick={() => onChange(option.value)}
              data-testid={`field-type-option-${option.value}`}
            >
              <Text>{option.label}</Text>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}

export function PropertyField({
  title,
  children,
  tooltip,
}: {
  title: string;
  children: ReactNode;
  tooltip?: ReactNode;
}) {
  return (
    <VStack align="start" gap={3} width="full">
      <WorkflowPropertySectionTitle tooltip={tooltip}>{title}</WorkflowPropertySectionTitle>
      {children}
    </VStack>
  );
}

export type WorkflowFieldArrayForm = {
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
  onChange?: (data: WorkflowFieldArrayForm) => void;
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
    getValues,
    setValue,
    watch,
  } = useForm<WorkflowFieldArrayForm>({
    defaultValues: {
      fields: node.data[field] ?? [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "fields",
  });

  // The type vocabulary a field row can pick. Image is only meaningful on
  // inputs (e.g. dataset columns fed into a node), matching the prior
  // selector. Labels come from the shared TYPE_LABELS so Text/Number/...
  // read the same everywhere.
  const fieldTypes: FieldType["type"][] =
    field === "inputs"
      ? ["str", "image", "float", "bool", "dict", "list"]
      : ["str", "float", "bool", "dict", "list"];
  const typeOptions: WorkflowFieldTypeOption[] = fieldTypes.map((value) => ({
    value,
    label: workflowFieldTypeLabels[value] ?? value,
  }));

  const updateNodeInternals = useUpdateNodeInternals();

  const onSubmit = (data: WorkflowFieldArrayForm) => {
    setNode({
      id: node.id,
      data: { [field]: data.fields },
    });
    updateNodeInternals(node.id);
    onChange?.(data);
  };

  const handleOnChange = (data: WorkflowFieldArrayForm) => {
    onChange?.(data);
    // We are pretending to submit on every change
    onSubmit(data);
  };

  // Re-sync the form when the node's fields change from OUTSIDE the form:
  // attaching a dataset merges its columns into the entry node, and the
  // evaluator toggle swaps the end node's results. Keyed on a content
  // signature, not the array reference, so a fresh reference each render
  // can't loop; guarded against the form already matching so the user's own
  // edits - which round-trip through setNode and return identical - never
  // trigger a replace mid-typing.
  const currentFields = node.data[field] ?? [];
  const fieldsSignature = JSON.stringify(
    currentFields.map((f) => [f.identifier, f.type, f.optional ?? false]),
  );
  useEffect(() => {
    const formSignature = JSON.stringify(
      getValues("fields").map((f) => [f.identifier, f.type, f.optional ?? false]),
    );
    if (formSignature === fieldsSignature) return;
    replace(currentFields);

    const updateInternalsTimeout = setTimeout(() => {
      updateNodeInternals(node.id);
    }, 0);
    return () => clearTimeout(updateInternalsTimeout);
  }, [currentFields, fieldsSignature, getValues, node.id, replace, updateNodeInternals]);

  const watchedFields = watch("fields");

  return (
    <VStack
      as="form"
      align="start"
      gap={3}
      width="full"
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
      onChange={(event) => {
        void handleSubmit(handleOnChange)(event);
      }}
    >
      <HStack width="full">
        <WorkflowPropertySectionTitle>{title}</WorkflowPropertySectionTitle>
        <Spacer />
        {!readOnly ? (
          <Button
            size="xs"
            variant="ghost"
            data-testid={`add-${field}-field-button`}
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
            const identifiers = getValues("fields").map((formField) => formField.identifier);
            return (
              identifiers.filter((id: string) => id === value).length === 1 ||
              "Duplicate identifier"
            );
          },
        });

        return (
          <Field.Root key={field_.id} invalid={!!errors.fields?.[index]?.identifier}>
            <HStack width="full">
              <HStack background="bg.muted" paddingRight={2} borderRadius="8px" width="full">
                {!readOnly ? (
                  <Input
                    {...identifierField}
                    onChange={(e) => {
                      e.target.value = e.target.value.replace(/ /g, "_").toLowerCase();
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
                <HStack paddingX={1} paddingY={1} height="full">
                  <WorkflowFieldTypeSelect
                    value={watchedFields[index]?.type ?? "str"}
                    options={typeOptions}
                    readOnly={readOnly}
                    onChange={(newType) => {
                      setValue(`fields.${index}.type`, newType, {
                        shouldDirty: true,
                      });
                      void handleSubmit(handleOnChange)();
                    }}
                    testId={`field-type-select-${field}-${index}`}
                  />
                </HStack>
              </HStack>
              {!readOnly ? (
                <Button
                  colorPalette="gray"
                  size="sm"
                  height="40px"
                  data-testid={`remove-${field}-${index}-field`}
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
            <Field.ErrorText>{errors.fields?.[index]?.identifier?.message}</Field.ErrorText>
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
 */
export function FieldsForm({
  node,
  field,
  defaultLlmModel,
  renderLlmConfigField,
}: {
  node: Node<Component>;
  field: "parameters" | "inputs" | "outputs";
  defaultLlmModel?: string;
  renderLlmConfigField?: (props: {
    llmConfig: LLMConfig;
    onChange: (llmConfig: LLMConfig) => void;
  }) => ReactNode;
}) {
  const { setNode } = useWorkflowStore(
    useShallow((state) => ({
      setNode: state.setNode,
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
  } = useForm<WorkflowFieldArrayForm>({
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
    (data: WorkflowFieldArrayForm) => {
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
          const parsedLlmConfig = llmConfigSchema.safeParse(field.value);
          const llmConfig = parsedLlmConfig.success
            ? parsedLlmConfig.data
            : { model: defaultLlmModel ?? "" };

          return renderLlmConfigField?.({
            llmConfig,
            onChange: (nextLlmConfig) => {
              setValue(`fields.${index}.value`, nextLlmConfig, {
                shouldValidate: true,
              });
            },
          });
        }

        // Skip code fields - they're handled by CodePropertiesPanel
        if (field.type === "code") {
          return null;
        }

        return (
          <Field.Root key={field.id} invalid={!!errors.fields?.[index]?.identifier}>
            <VStack align="start" gap={3} width="full">
              <HStack width="full">
                <WorkflowPropertySectionTitle>
                  {camelCaseToTitleCase(field.identifier)}
                </WorkflowPropertySectionTitle>
                {field.optional && (
                  <Text color="fg.muted" fontSize="12px">
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
                  <Input type="text" size="sm" {...control.register(`fields.${index}.value`)} />
                )}
              </HStack>
              <Field.ErrorText>{errors.fields?.[index]?.identifier?.message}</Field.ErrorText>
            </VStack>
          </Field.Root>
        );
      })}
    </VStack>
  );
}

export type WorkflowNodeIconProps = {
  type: ComponentType;
  cls?: string;
  size: "lg";
};

export type WorkflowNodeNameProps = {
  name: string;
  onClick: () => void;
  cursor?: "pointer";
};

export function WorkflowBasePropertiesPanel({
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
  defaultLlmModel,
  renderLlmConfigField,
  renderNodeIcon,
  renderNodeName,
  onInvalidNodeName,
  ...props
}: {
  node: Node<Component> | StudioWorkflow;
  header?: ReactNode;
  children?: ReactNode;
  fieldsAfter?: ReactNode;
  hideParameters?: boolean;
  hideInputs?: boolean;
  inputsTitle?: string;
  hideOutputs?: boolean;
  inputsReadOnly?: boolean;
  outputsTitle?: string;
  outputsReadOnly?: boolean;
  hideDescription?: boolean;
  hideHeader?: boolean;
  defaultLlmModel?: string;
  renderLlmConfigField?: (props: {
    llmConfig: LLMConfig;
    onChange: (llmConfig: LLMConfig) => void;
  }) => ReactNode;
  renderNodeIcon?: (props: WorkflowNodeIconProps) => ReactNode;
  renderNodeName?: (props: WorkflowNodeNameProps) => ReactNode;
  onInvalidNodeName?: (message: string) => void;
  maxWidth?: string;
} & StackProps) {
  const insideDrawer = useInsideDrawer();

  const {
    deselectAllNodes,
    propertiesExpanded,
    setPropertiesExpanded,
    setNode,
    nodes: workflowNodes,
  } = useWorkflowStore(
    useShallow((state) => ({
      deselectAllNodes: state.deselectAllNodes,
      propertiesExpanded: state.propertiesExpanded,
      setPropertiesExpanded: state.setPropertiesExpanded,
      setNode: state.setNode,
      nodes: state.nodes,
    })),
  );

  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState<string | undefined>(undefined);

  const isWorkflow = (node: Node<Component> | StudioWorkflow): node is StudioWorkflow =>
    !("data" in node);
  const parsedComponentType = !isWorkflow(node)
    ? componentTypeSchema.safeParse(node.type)
    : undefined;
  const nodeDescription = !isWorkflow(node) ? node.data.description : undefined;

  const handleNameChange = (value: string, id: string) => {
    const result = validateNodeName({
      name: value,
      currentNodeId: id,
      existingNodeIds: workflowNodes.map((n) => n.id),
    });
    if (!result.valid) {
      onInvalidNodeName?.(result.error);
      return;
    }
    const newId = nameToId(value);
    setNode({ id, data: { name: value } }, newId);
  };

  const shouldHideHeader = hideHeader || insideDrawer;

  return (
    <VStack
      align="start"
      gap={6}
      padding={3}
      {...(!insideDrawer && {
        maxWidth: "550px",
        width: "25vw",
        minWidth: "350px",
      })}
      height="full"
      {...(!insideDrawer && { overflowY: "auto" })}
      {...props}
    >
      {!shouldHideHeader && (
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
                  {parsedComponentType?.success &&
                    renderNodeIcon?.({
                      type: parsedComponentType.data,
                      cls: node.data.cls,
                      size: "lg",
                    })}
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
                        if (e.key === "Escape") {
                          setIsEditingName(false);
                          setName(undefined);
                        }
                      }}
                    />
                  ) : (
                    (renderNodeName?.({
                      name: getNodeDisplayName(node),
                      onClick: () => {
                        if (node.type !== "prompting_technique") {
                          setIsEditingName(true);
                        }
                      },
                      cursor: node.type === "prompting_technique" ? undefined : "pointer",
                    }) ?? (
                      <Text fontSize="15px" fontWeight={500}>
                        {getNodeDisplayName(node)}
                      </Text>
                    ))
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
                    <ComponentExecutionButton node={node} size="sm" iconSize={16} />
                  </HStack>

                  <Button
                    variant="ghost"
                    size="sm"
                    color="fg.muted"
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
                color="fg.muted"
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
          {!hideDescription && nodeDescription && (
            <Text fontSize="12px" color="fg.muted" paddingX={2}>
              {nodeDescription}
            </Text>
          )}
        </VStack>
      )}
      {children}
      {!isWorkflow(node) && (
        <>
          {!hideParameters && (
            <FieldsForm
              node={node}
              field="parameters"
              defaultLlmModel={defaultLlmModel}
              renderLlmConfigField={renderLlmConfigField}
            />
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
