import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import React, { useMemo } from "react";
import { Info, Plus, Trash2, X } from "react-feather";
import {
  Controller,
  type FieldErrors,
  useFieldArray,
  useFormContext,
} from "react-hook-form";
import { type ZodType, z } from "zod";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { AddModelProviderKey } from "../../optimization_studio/components/AddModelProviderKey";
import type {
  EvaluatorDefinition,
  Evaluators,
  EvaluatorTypes,
} from "../../server/evaluations/evaluators";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import { api } from "../../utils/api";
import { camelCaseToTitleCase, titleCase } from "../../utils/stringCasing";
import { HorizontalFormControl } from "../HorizontalFormControl";
import {
  allModelOptions,
  ModelSelector,
  useModelSelectionOptions,
} from "../ModelSelector";
import { SmallLabel } from "../SmallLabel";
import { PropertySectionTitle } from "../ui/PropertySectionTitle";
import { Switch } from "../ui/switch";
import { Tooltip } from "../ui/tooltip";
import type { CheckConfigFormData } from "./CheckConfigForm";

// Simple component to handle model disabled check
const ModelSelectorWithWarning = ({
  selectorOptions,
  field,
  fieldName,
  variant,
}: {
  selectorOptions: string[];
  field: any;
  fieldName: string;
  variant: string;
}) => {
  const { modelOption } = useModelSelectionOptions(
    selectorOptions,
    field.value,
    fieldName === "model" ? "chat" : "embedding",
  );
  const isModelDisabled = modelOption?.isDisabled ?? false;

  return (
    <VStack align="start" width="full">
      <ModelSelector
        options={selectorOptions}
        model={field.value}
        onChange={(model) => field.onChange(model)}
        mode={fieldName === "model" ? "chat" : "embedding"}
        size={variant === "studio" ? "sm" : "md"}
      />
      {isModelDisabled && (
        <AddModelProviderKey
          runWhat="run this evaluation"
          nodeProvidersWithoutCustomKeys={[
            field.value.split("/")[0] ?? "unknown",
          ]}
        />
      )}
    </VStack>
  );
};

import { EvaluatorLLMConfigField } from "./EvaluatorLLMConfigField";

// Toggle-button field for array-of-literal-union fields (e.g. include_metrics:
// z.array(z.union([z.literal("cost"), z.literal("duration")]))). Each option
// is a sticky toggle button with a hover-tooltip explaining what the metric
// is and why it matters for the judge prompt — replaces the generic dropdown
// + "Add" array UI for fields where the option set is small and fixed.
type MetricMeta = { label: string; tooltip: string };
const METRIC_META: Record<string, MetricMeta> = {
  cost: {
    label: "Cost",
    tooltip:
      "Per-candidate model spend (USD), summed across the candidate's run. Injected so the judge can prefer cheaper options when quality is comparable. Use cautiously — judges may over-weight cost.",
  },
  duration: {
    label: "Duration",
    tooltip:
      "Per-candidate wall-clock latency (ms) for this row's call. For aggregate views, p95 is reported in the leaderboard — the value sent to the judge here is the single-row time.",
  },
};

const MetricToggleField = ({
  fieldName,
  options,
  variant,
}: {
  fieldName: string;
  options: string[];
  variant: "default" | "studio";
}) => {
  const { control } = useFormContext();
  return (
    <Controller
      name={fieldName}
      control={control}
      defaultValue={[]}
      render={({ field: { value, onChange } }) => {
        const selected: string[] = Array.isArray(value) ? value : [];
        const toggle = (opt: string) => {
          const next = selected.includes(opt)
            ? selected.filter((v) => v !== opt)
            : [...selected, opt];
          onChange(next);
        };
        return (
          <VStack align="start" gap={2} width="full">
            {options.map((opt) => {
              const meta = METRIC_META[opt] ?? { label: opt, tooltip: opt };
              const isOn = selected.includes(opt);
              return (
                <HStack key={opt} gap={2} width="full">
                  <Switch
                    id={`metric-${opt}`}
                    checked={isOn}
                    onCheckedChange={({ checked }) => {
                      if (checked !== isOn) toggle(opt);
                    }}
                    size={variant === "studio" ? "sm" : "md"}
                  />
                  <Field.Label
                    htmlFor={`metric-${opt}`}
                    marginBottom="0"
                    fontWeight={variant === "studio" ? 400 : undefined}
                    fontSize={variant === "studio" ? "13px" : undefined}
                    cursor="pointer"
                  >
                    Include {meta.label.toLowerCase()}
                  </Field.Label>
                  <Tooltip
                    content={meta.tooltip}
                    showArrow
                    positioning={{ placement: "top" }}
                  >
                    <Box
                      as="span"
                      display="inline-flex"
                      color="fg.subtle"
                      _hover={{ color: "fg.muted" }}
                      cursor="help"
                    >
                      <Info size={14} />
                    </Box>
                  </Tooltip>
                </HStack>
              );
            })}
          </VStack>
        );
      }}
    />
  );
};

// Separate component for array fields to handle useFieldArray hook
const ArrayField = <T extends EvaluatorTypes>({
  fieldSchema,
  fieldName,
  prefix,
  evaluator,
  variant = "default",
  renderField,
}: {
  fieldSchema: ZodType;
  fieldName: string;
  prefix: string;
  evaluator: EvaluatorDefinition<T> | undefined;
  variant?: "default" | "studio";
  renderField: <T extends EvaluatorTypes>(
    fieldSchema: ZodType,
    fieldName: string,
    evaluator: EvaluatorDefinition<T> | undefined,
  ) => React.JSX.Element | null;
}) => {
  const { control } = useFormContext();
  const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;

  const { fields, append, remove } = useFieldArray({
    control,
    name: fullPath,
  });

  // Cast to ZodArray to access element property
  const arraySchema = fieldSchema as z.ZodArray<any>;

  const defaultValues = useMemo(() => {
    return arraySchema.element instanceof z.ZodObject
      ? Object.fromEntries(
          Object.entries(arraySchema.element.shape).flatMap(([key, value]) => {
            if (value instanceof z.ZodUnion && value.options.length > 0) {
              const defaultValue = value.options[0].value;
              return [[key, defaultValue]];
            }

            return [];
          }),
        )
      : {};
  }, [arraySchema.element]);

  return (
    <VStack align="start" width="full">
      {variant === "studio" && (
        <Button
          position="absolute"
          right={0}
          top="-36px"
          padding={0}
          size="sm"
          variant="ghost"
          onClick={() => append(defaultValues)}
        >
          <Plus size={16} />
        </Button>
      )}
      {fields.map((field, index) => (
        <Box
          key={field.id}
          borderLeft={
            arraySchema.element instanceof z.ZodObject ? "4px solid" : undefined
          }
          borderLeftColor={variant === "studio" ? "border" : "orange.400"}
          width="full"
        >
          <HStack
            borderLeftColor="reset"
            padding={arraySchema.element instanceof z.ZodObject ? 3 : 0}
            paddingRight={variant === "studio" ? 0 : 3}
            width="full"
            align="start"
            position="relative"
          >
            <Button
              position="absolute"
              right={0}
              top={0}
              padding={0}
              size="sm"
              variant="ghost"
              onClick={() => remove(index)}
              color="fg.subtle"
            >
              {variant === "studio" ? <Trash2 size={14} /> : <X size={18} />}
            </Button>
            <Box width={variant === "studio" ? "100%" : "95%"}>
              {renderField(
                arraySchema.element,
                `${fieldName}.${index}`,
                evaluator,
              )}
            </Box>
          </HStack>
        </Box>
      ))}
      {variant !== "studio" && (
        <Button onClick={() => append(defaultValues)}>Add</Button>
      )}
    </VStack>
  );
};

const DynamicZodForm = ({
  schema,
  evaluatorType,
  prefix,
  errors,
  variant = "default",
  onlyFields,
  skipFields,
}: {
  schema: ZodType;
  evaluatorType: EvaluatorTypes;
  prefix: string;
  errors: FieldErrors<CheckConfigFormData>["settings"];
  variant?: "default" | "studio";
  onlyFields?: string[];
  skipFields?: string[];
}) => {
  const { control, register } = useFormContext();
  const { project } = useOrganizationTeamProject();

  // Cascade-resolved defaults for evaluator model + embeddings fields.
  const resolvedDefaultModel = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );
  const resolvedDefaultEmbeddings =
    api.modelProvider.getResolvedDefault.useQuery(
      {
        projectId: project?.id ?? "",
        featureKey: "analytics.topic_clustering_embeddings",
      },
      { enabled: !!project?.id },
    );

  const renderField = <T extends EvaluatorTypes>(
    fieldSchema: ZodType,
    fieldName: string,
    evaluator: EvaluatorDefinition<T> | undefined,
  ): React.JSX.Element | null => {
    const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
    let defaultValue =
      evaluator?.settings?.[fieldName as keyof Evaluators[T]["settings"]]
        ?.default;

    if (fieldName === "model") {
      defaultValue = (resolvedDefaultModel.data?.model ?? "") as any;
    }
    if (fieldName === "embeddings_model") {
      defaultValue = (resolvedDefaultEmbeddings.data?.model ?? "") as any;
    }

    const fieldSchema_ =
      fieldSchema instanceof z.ZodOptional ? fieldSchema.unwrap() : fieldSchema;

    const fieldKey = fieldName.split(".").toReversed()[0] ?? "";

    if (fieldSchema_ instanceof z.ZodDefault) {
      return renderField(fieldSchema_._def.innerType, fieldName, evaluator);
    } else if (fieldSchema_ instanceof z.ZodNumber) {
      return (
        <Input
          type="number"
          size={variant === "studio" ? "sm" : "md"}
          step={
            typeof defaultValue === "number" &&
            Math.round(defaultValue) != defaultValue
              ? "0.01"
              : "1"
          }
          {...register(fullPath, { setValueAs: (val) => +val })}
        />
      );
    } else if (fieldSchema_ instanceof z.ZodBoolean) {
      return (
        <Field.Root>
          <HStack width="full" gap={2}>
            <Controller
              name={fullPath}
              control={control}
              render={({ field: { onChange, onBlur, value, name, ref } }) => (
                <Switch
                  id={fullPath}
                  checked={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  name={name}
                  ref={ref}
                  size={variant === "studio" ? "sm" : "md"}
                  paddingLeft={variant === "studio" ? 2 : undefined}
                />
              )}
            />
            <Field.Label
              htmlFor={fullPath}
              marginBottom="0"
              fontWeight={variant === "studio" ? 400 : undefined}
              fontSize={variant === "studio" ? "13px" : undefined}
            >
              {camelCaseToTitleCase(fieldName.split(".").toReversed()[0] ?? "")}
            </Field.Label>
          </HStack>
        </Field.Root>
      );
    } else if (
      fieldSchema_ instanceof z.ZodUnion ||
      fieldSchema_ instanceof z.ZodLiteral ||
      (fieldSchema_ instanceof z.ZodString &&
        (fieldName === "model" || fieldName === "embeddings_model"))
    ) {
      const options =
        fieldSchema_ instanceof z.ZodUnion
          ? fieldSchema_.options
          : fieldSchema_ instanceof z.ZodLiteral
            ? [{ value: fieldSchema_.value }]
            : allModelOptions.map((option) => ({ value: option }));
      if (
        (fieldName === "model" || fieldName === "embeddings_model") &&
        evaluator?.name !== "OpenAI Moderation"
      ) {
        const selectorOptions =
          fieldName === "model"
            ? options.map((option: { value: string }) => option.value)
            : options.map((option: { value: string }) => option.value);

        return (
          <Controller
            name={fullPath}
            control={control}
            render={({ field }) => {
              return (
                <ModelSelectorWithWarning
                  selectorOptions={selectorOptions}
                  field={field}
                  fieldName={fieldName}
                  variant={variant}
                />
              );
            }}
          />
        );
      }

      return (
        <Controller
          name={fullPath}
          control={control}
          render={({ field }) => (
            <NativeSelect.Root size={variant === "studio" ? "sm" : "md"}>
              <NativeSelect.Field
                {...field}
                onChange={(e) => {
                  const literalValues = options.map(
                    (option: any) => option.value,
                  );

                  if (e.target.value === "") {
                    field.onChange(undefined);
                  } else if (
                    !isNaN(+e.target.value) &&
                    literalValues.includes(+e.target.value)
                  ) {
                    field.onChange(+e.target.value);
                  } else {
                    field.onChange(e.target.value);
                  }
                }}
              >
                {fieldSchema instanceof z.ZodOptional && (
                  <option value=""></option>
                )}
                {options.map((option: { value: string }, index: number) => (
                  <option key={index} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          )}
        />
      );
    } else if (fieldSchema_ instanceof z.ZodString) {
      if (["topic", "name"].includes(fieldKey) || !isNaN(+fieldKey)) {
        return (
          <Input
            size={variant === "studio" ? "sm" : "md"}
            {...register(fullPath)}
          />
        );
      }
      return (
        <Textarea
          size={variant === "studio" ? "sm" : "md"}
          {...register(fullPath)}
        />
      );
    } else if (fieldSchema_ instanceof z.ZodArray) {
      // Special-case: small, fixed sets of literal options render as toggle
      // pills with hover-tooltips (e.g. include_metrics for pairwise_compare).
      // The array UI's dropdown + "Add" pattern hides what each option means
      // and over-fits to large open-ended arrays.
      const element = fieldSchema_.element;
      const isLiteralUnion =
        element instanceof z.ZodUnion &&
        element.options.every((o: any) => o instanceof z.ZodLiteral);
      if (fieldKey === "include_metrics" && isLiteralUnion) {
        const options = (element.options as z.ZodLiteral<string>[]).map(
          (o) => o.value,
        );
        return (
          <MetricToggleField
            fieldName={fullPath}
            options={options}
            variant={variant}
          />
        );
      }
      return (
        <ArrayField
          fieldSchema={fieldSchema_}
          fieldName={fieldName}
          prefix={prefix}
          evaluator={evaluator}
          variant={variant}
          renderField={renderField}
        />
      );
    } else if (fieldSchema_ instanceof z.ZodObject) {
      return (
        <VStack width="full" gap={2}>
          {Object.keys(fieldSchema_.shape).map((key) => (
            <VStack key={key} align="start" width="full">
              {!(fieldSchema_.shape[key] instanceof z.ZodBoolean) && (
                <SmallLabel>
                  {fieldName.startsWith("rubrics.")
                    ? `Level ${parseInt(fieldName.split(".")[1] ?? "0") + 1}`
                    : titleCase(key)}
                </SmallLabel>
              )}
              {renderField(
                fieldSchema_.shape[key],
                `${fieldName}.${key}`,
                evaluator,
              )}
            </VStack>
          ))}
        </VStack>
      );
    }

    return null;
  };

  const renderSchema = <T extends EvaluatorTypes>(
    schema: ZodType<Evaluators[T]["settings"]>,
    basePath = "",
  ) => {
    if (schema instanceof z.ZodObject) {
      const evaluatorDefinition = getEvaluatorDefinitions(
        evaluatorType,
      ) as EvaluatorDefinition<T>;

      const keys = Object.keys(schema.shape);

      // Detect model + max_tokens pattern (but NOT embeddings_model)
      // These should be rendered as a unified LLMConfigField
      const hasModelField = keys.includes("model");
      const hasMaxTokensField = keys.includes("max_tokens");
      const shouldUseCompositeField = hasModelField && hasMaxTokensField;

      // Filter out model/max_tokens when using composite field
      const fieldsToRender = shouldUseCompositeField
        ? keys.filter((k) => k !== "model" && k !== "max_tokens")
        : keys;

      // Render the composite LLM config field (if applicable)
      const compositeField = shouldUseCompositeField ? (
        variant === "studio" ? (
          <VStack key="llm-config" as="form" align="start" gap={3} width="full">
            <HStack width="full">
              <PropertySectionTitle>Model</PropertySectionTitle>
            </HStack>
            <Field.Root>
              <EvaluatorLLMConfigField prefix={prefix} />
            </Field.Root>
          </VStack>
        ) : (
          <React.Fragment key="llm-config">
            <HorizontalFormControl
              label="Model"
              helper="The model to use for evaluation"
            >
              <EvaluatorLLMConfigField prefix={prefix} />
            </HorizontalFormControl>
          </React.Fragment>
        )
      ) : null;

      // Render remaining fields
      const renderedFields = fieldsToRender
        .filter((key) => !skipFields?.includes(key))
        .filter((key) => (onlyFields ? onlyFields.includes(key) : true))
        .map((key) => {
          const field = schema.shape[key];
          const isOptional = field instanceof z.ZodOptional;
          const helperText =
            evaluatorDefinition?.settings?.[
              key as keyof Evaluators[T]["settings"]
            ].description ?? "";
          const isInvalid = errors && key in errors && !!(errors as any)[key];

          if (variant === "studio") {
            return (
              <VStack key={key} as="form" align="start" gap={3} width="full">
                <HStack width="full">
                  <PropertySectionTitle>
                    {camelCaseToTitleCase(key)}
                  </PropertySectionTitle>
                  {isOptional && (
                    <Text color="fg.muted" fontSize="12px">
                      (optional)
                    </Text>
                  )}
                  {helperText && (
                    <Tooltip
                      content={helperText}
                      positioning={{ placement: "top" }}
                    >
                      <Info size={14} />
                    </Tooltip>
                  )}
                </HStack>
                <Field.Root invalid={isInvalid}>
                  {renderField(
                    field,
                    basePath ? `${basePath}.${key}` : key,
                    evaluatorDefinition,
                  )}
                </Field.Root>
              </VStack>
            );
          }

          return (
            <React.Fragment key={key}>
              <HorizontalFormControl
                label={
                  camelCaseToTitleCase(key) + (isOptional ? " (Optional)" : "")
                }
                helper={helperText}
                invalid={isInvalid}
              >
                {renderField(
                  field,
                  basePath ? `${basePath}.${key}` : key,
                  evaluatorDefinition,
                )}
              </HorizontalFormControl>
            </React.Fragment>
          );
        });

      // Return composite field first (if any), then remaining fields
      return (
        <>
          {compositeField}
          {renderedFields}
        </>
      );
    }
    return null;
  };

  return <>{renderSchema(schema)}</>;
};

export default DynamicZodForm;
