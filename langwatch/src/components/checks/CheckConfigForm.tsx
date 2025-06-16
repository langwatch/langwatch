import {
  Accordion,
  Alert,
  Button,
  Card,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { EvaluationExecutionMode } from "@prisma/client";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Edit2, HelpCircle } from "react-feather";
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { slugify } from "~/utils/slugify";
import { z } from "zod";
import { useAvailableEvaluators } from "../../hooks/useAvailableEvaluators";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import {
  DEFAULT_MAPPINGS,
  migrateLegacyMappings,
} from "../../server/evaluations/evaluationMappings";
import {
  type Evaluators,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import {
  evaluatorsSchema,
  evaluatorTypesSchema,
} from "../../server/evaluations/evaluators.zod.generated";
import {
  getEvaluatorDefaultSettings,
  getEvaluatorDefinitions,
} from "../../server/evaluations/getEvaluator";
import type { CheckPreconditions } from "../../server/evaluations/types";
import { checkPreconditionsSchema } from "../../server/evaluations/types.generated";
import {
  mappingStateSchema,
  type MappingState,
} from "../../server/tracer/tracesMapping";
import { api } from "../../utils/api";
import { EvaluatorTracesMapping } from "../evaluations/EvaluatorTracesMapping";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { Tooltip } from "../ui/tooltip";
import DynamicZodForm from "./DynamicZodForm";
import { EvaluationManualIntegration } from "./EvaluationManualIntegration";
import { EvaluatorSelection, evaluatorTempNameMap } from "./EvaluatorSelection";
import { PreconditionsField } from "./PreconditionsField";
import { TryItOut } from "./TryItOut";
import { usePublicEnv } from "../../hooks/usePublicEnv";

export interface CheckConfigFormData {
  name: string;
  checkType: EvaluatorTypes | undefined;
  sample: number;
  preconditions: CheckPreconditions;
  settings: Evaluators[EvaluatorTypes]["settings"];
  executionMode: EvaluationExecutionMode;
  storeSettingsOnCode: boolean;
  mappings: MappingState;
}

interface CheckConfigFormProps {
  checkId?: string;
  defaultValues?: Partial<CheckConfigFormData>;
  onSubmit: (data: CheckConfigFormData) => Promise<void>;
  loading: boolean;
}

export default function CheckConfigForm({
  checkId,
  defaultValues,
  onSubmit,
  loading,
}: CheckConfigFormProps) {
  const { project } = useOrganizationTeamProject();
  const isNameAvailable = api.monitors.isNameAvailable.useMutation();
  const [isNameAlreadyInUse, setIsNameAlreadyInUse] = useState(false);
  const publicEnv = usePublicEnv();

  const validateNameUniqueness = async (name: string) => {
    const result = await isNameAvailable.mutateAsync({
      projectId: project?.id ?? "",
      name,
      checkId,
    });

    setIsNameAlreadyInUse(!result.available);

    return result.available;
  };

  const form = useForm<CheckConfigFormData>({
    defaultValues,
    resolver: (data, ...args) => {
      return zodResolver(
        z.object({
          name: z.string().min(1).max(255).refine(validateNameUniqueness),
          checkType: evaluatorTypesSchema,
          sample: z.number().min(0.01).max(1),
          preconditions: checkPreconditionsSchema,
          settings: data.checkType?.startsWith("custom/")
            ? z.object({}).optional()
            : evaluatorsSchema.shape[data.checkType ?? "langevals/basic"].shape
                .settings,
          executionMode: z
            .enum([
              EvaluationExecutionMode.ON_MESSAGE,
              EvaluationExecutionMode.AS_GUARDRAIL,
              EvaluationExecutionMode.MANUALLY,
            ])
            .optional(),
          mappings: mappingStateSchema,
        })
      )({ ...data, settings: data.settings || {} }, ...args);
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = form;

  const checkType = watch("checkType");
  const preconditions = watch("preconditions");
  const nameValue = watch("name");
  const sample = watch("sample");
  const executionMode = watch("executionMode");
  const storeSettingsOnCode = watch("storeSettingsOnCode");
  const mappings = watch("mappings") ?? DEFAULT_MAPPINGS;
  const settings = watch("settings");

  useEffect(() => {
    if (mappings && !mappings.mapping) {
      form.setValue("mappings", migrateLegacyMappings(mappings as any));
    }
  }, [form, mappings]);

  const {
    fields: fieldsPrecondition,
    append: appendPrecondition,
    remove: removePrecondition,
  } = useFieldArray({
    control,
    name: "preconditions",
  });
  const slug = slugify(nameValue || "", {
    lower: true,
    strict: true,
  });

  const router = useRouter();
  const isChoosing = router.pathname.endsWith("/choose");

  const availableEvaluators = useAvailableEvaluators();

  useEffect(() => {
    if (!checkType && !isChoosing) {
      void router.replace({
        pathname: router.pathname + "/choose",
        query: router.query,
      });
    }
  }, [checkType, isChoosing, router]);

  useEffect(() => {
    if (!availableEvaluators) return;
    if (defaultValues?.settings && defaultValues.checkType === checkType)
      return;

    if (!checkType) return;

    let defaultName = getEvaluatorDefinitions(checkType)?.name;
    defaultName = evaluatorTempNameMap[defaultName ?? ""] ?? defaultName;
    const allDefaultNames = Object.values(availableEvaluators).map(
      (evaluator) => evaluatorTempNameMap[evaluator.name] ?? evaluator.name
    );
    if (!nameValue || allDefaultNames.includes(nameValue)) {
      form.setValue(
        "name",
        checkType.includes("custom") ? "" : defaultName ?? ""
      );
    }

    const setDefaultSettings = (
      defaultValues: Record<string, any>,
      prefix: string
    ) => {
      if (!defaultValues) return;

      Object.entries(defaultValues).forEach(([key, value]) => {
        if (
          typeof value === "object" &&
          !Array.isArray(value) &&
          value !== null
        ) {
          setDefaultSettings(value, `${prefix}.${key}`);
        } else {
          //@ts-ignore
          form.setValue(`${prefix}.${key}`, value);
        }
      });
    };

    setDefaultSettings(
      getEvaluatorDefaultSettings(
        availableEvaluators[checkType],
        undefined,
        publicEnv.data?.IS_ATLA_DEFAULT_JUDGE
      ),
      "settings"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkType, defaultValues?.checkType, defaultValues?.settings]);

  const accordionIndex = checkType?.startsWith("custom/") ? 0 : undefined;
  const [accordionValue, setAccordionValue] = useState(
    accordionIndex ? ["0"] : []
  );

  const runOn = (
    <Text color="gray.500" fontStyle="italic">
      This check will run on{" "}
      {sample >= 1
        ? "every message"
        : `${+(sample * 100).toFixed(2)}% of messages`}
      {preconditions?.length > 0 && " matching the preconditions"}
    </Text>
  );

  const evaluatorDefinition = useMemo(
    () => checkType && availableEvaluators?.[checkType],
    [checkType, availableEvaluators]
  );

  const fields = useMemo(() => {
    return [
      ...(evaluatorDefinition?.requiredFields ?? []),
      ...(evaluatorDefinition?.optionalFields ?? []),
    ];
  }, [evaluatorDefinition]);

  return (
    <FormProvider {...form}>
      <form
        onSubmit={handleSubmit((data) => {
          return onSubmit(data);
        })}
        style={{ width: "100%" }}
      >
        {!checkType || isChoosing || !availableEvaluators ? (
          <EvaluatorSelection form={form} />
        ) : (
          <VStack gap={6} align="start" width="full">
            <Card.Root width="full">
              <Card.Body>
                <VStack gap={0}>
                  <HorizontalFormControl
                    label="Evaluation Type"
                    helper="Select the evaluation to run"
                    invalid={!!errors.checkType}
                  >
                    <VStack align="start" width="full">
                      <HStack gap={0} width="full">
                        <Text>
                          {evaluatorTempNameMap[
                            availableEvaluators[checkType].name
                          ] ?? availableEvaluators[checkType].name}
                        </Text>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            void router.push({
                              pathname: router.pathname + "/choose",
                              query: router.query,
                            });
                          }}
                          marginLeft={4}
                          fontWeight="normal"
                          color="gray.600"
                        >
                          <Edit2 size={14} />
                        </Button>
                      </HStack>
                      <Text fontSize="12px" color="gray.500">
                        {availableEvaluators[checkType].description}
                      </Text>
                      {checkType.startsWith("legacy/") && (
                        <Alert.Root status="warning">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Text fontSize="13px">
                              You are using a legacy evaluator version, please
                              click the <b>change</b> button above to select a
                              newer version or a replacement for this evaluator.
                            </Text>
                          </Alert.Content>
                        </Alert.Root>
                      )}
                    </VStack>
                  </HorizontalFormControl>
                  <HorizontalFormControl
                    label="Name"
                    helper="Used to identify the check and call it from the API"
                    invalid={!!errors.name}
                    align="start"
                  >
                    <VStack gap={2} align="start">
                      <Input
                        id="name"
                        {...register("name", {
                          required: true,
                        })}
                      />
                      {isNameAlreadyInUse && (
                        <Text color="red.500" fontSize="13px">
                          An evaluation with the same name already exists,
                          please choose a different name to have a different
                          slug identifier as well
                        </Text>
                      )}
                      <Text fontSize="12px" paddingLeft={4}>
                        {nameValue && "slug: "}
                        {slug}
                      </Text>
                    </VStack>
                  </HorizontalFormControl>
                  {checkType && evaluatorsSchema.shape[checkType] && (
                    <DynamicZodForm
                      schema={evaluatorsSchema.shape[checkType].shape.settings}
                      evaluatorType={checkType}
                      prefix="settings"
                      errors={errors.settings}
                      skipFields={["max_tokens"]}
                    />
                  )}
                </VStack>
              </Card.Body>
            </Card.Root>

            <Card.Root width="full" padding={0}>
              <Card.Body padding={0}>
                <VStack paddingX={4} gap={0}>
                  <HorizontalFormControl
                    label="Execution Mode"
                    helper="Configure when this evaluation is executed"
                    invalid={!!errors.executionMode}
                    align="start"
                    _last={{ borderBottomWidth: "1px" }}
                  >
                    <NativeSelect.Root>
                      <NativeSelect.Field {...register("executionMode")}>
                        <option value={EvaluationExecutionMode.ON_MESSAGE}>
                          When message arrives
                        </option>
                        {evaluatorDefinition?.isGuardrail && (
                          <option value={EvaluationExecutionMode.AS_GUARDRAIL}>
                            As a Guardrail
                          </option>
                        )}
                        <option value={EvaluationExecutionMode.MANUALLY}>
                          Manually
                        </option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </HorizontalFormControl>
                  {executionMode !== EvaluationExecutionMode.ON_MESSAGE && (
                    <EvaluationManualIntegration
                      slug={slug}
                      evaluatorDefinition={availableEvaluators[checkType]!}
                      form={form}
                      checkType={checkType}
                      name={nameValue}
                      executionMode={executionMode}
                      settings={settings}
                      storeSettingsOnCode={storeSettingsOnCode}
                    />
                  )}
                </VStack>

                {executionMode === EvaluationExecutionMode.ON_MESSAGE && (
                  <Accordion.Root
                    value={accordionValue}
                    onValueChange={({ value }) => {
                      setAccordionValue(value);
                    }}
                    multiple
                  >
                    <Accordion.Item value="0">
                      <Accordion.ItemTrigger padding={4} paddingBottom={6}>
                        <Field.Root>
                          <VStack align="start" gap={1}>
                            <Field.Label margin={0}>
                              Execution Settings
                            </Field.Label>
                            <Field.HelperText margin={0} fontSize="13px">
                              Configure how and when this evaluation is executed
                              when a new message arrives
                            </Field.HelperText>
                          </VStack>
                        </Field.Root>
                        <Accordion.ItemIndicator>
                          <ChevronDown />
                        </Accordion.ItemIndicator>
                      </Accordion.ItemTrigger>
                      <Accordion.ItemContent paddingX={4}>
                        <HorizontalFormControl
                          label="Mappings"
                          helper="Map which fields from the trace will be used to run the evaluation"
                        >
                          <EvaluatorTracesMapping
                            targetFields={fields}
                            traceMapping={mappings}
                            setTraceMapping={(mapping) => {
                              form.setValue("mappings", mapping);
                            }}
                          />
                        </HorizontalFormControl>
                        <PreconditionsField
                          runOn={
                            preconditions?.length === 0 &&
                            !evaluatorDefinition?.requiredFields.includes(
                              "contexts"
                            ) ? (
                              sample == 1 ? (
                                runOn
                              ) : (
                                <Text color="gray.500" fontStyle="italic">
                                  No preconditions defined
                                </Text>
                              )
                            ) : null
                          }
                          append={appendPrecondition}
                          remove={removePrecondition}
                          fields={fieldsPrecondition}
                        />
                        {checkType && evaluatorsSchema.shape[checkType] && (
                          <DynamicZodForm
                            schema={
                              evaluatorsSchema.shape[checkType].shape.settings
                            }
                            evaluatorType={checkType}
                            prefix="settings"
                            errors={errors.settings}
                            onlyFields={["max_tokens"]}
                          />
                        )}
                        <HorizontalFormControl
                          label="Sampling"
                          helper="Run this check only on a sample of messages (min 0.01, max 1.0)"
                          invalid={!!errors.sample}
                          align="start"
                        >
                          <Controller
                            control={control}
                            name="sample"
                            render={({ field }) => (
                              <VStack align="start">
                                <HStack>
                                  <Input
                                    width="110px"
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    placeholder="0.0"
                                    {...field}
                                    onChange={(e) =>
                                      field.onChange(+e.target.value)
                                    }
                                  />
                                  <Tooltip content="You can use this to save costs on expensive checks if you have too many messages incomming. From 0.01 to run on 1% of the messages to 1.0 to run on 100% of the messages">
                                    <HelpCircle width="14px" />
                                  </Tooltip>
                                </HStack>
                                {runOn}
                              </VStack>
                            )}
                          />
                        </HorizontalFormControl>
                      </Accordion.ItemContent>
                    </Accordion.Item>
                  </Accordion.Root>
                )}
              </Card.Body>
            </Card.Root>

            <HStack width="full">
              <Spacer />
              <Tooltip
                content={
                  storeSettingsOnCode
                    ? 'You checked the "Store the settings on code" option, so the evaluation is configured directly on your codebase, saving is disabled'
                    : undefined
                }
              >
                <Button
                  colorPalette="orange"
                  type="submit"
                  minWidth="92px"
                  loading={loading}
                  disabled={storeSettingsOnCode}
                >
                  Save
                </Button>
              </Tooltip>
            </HStack>
            <TryItOut form={form} />
          </VStack>
        )}
      </form>
    </FormProvider>
  );
}
