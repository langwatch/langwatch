import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Select,
  Spacer,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { EvaluationExecutionMode } from "@prisma/client";
import type { JsonArray } from "@prisma/client/runtime/library";
import type { Edge, Node } from "@xyflow/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ArrowRight, HelpCircle } from "react-feather";
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
  type UseFormRegister,
} from "react-hook-form";
import slugify from "slugify";
import { z } from "zod";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { getInputsOutputs } from "../../optimization_studio/utils/nodeUtils";
import {
  AVAILABLE_EVALUATORS,
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
import { api } from "../../utils/api";
import { HorizontalFormControl } from "../HorizontalFormControl";
import DynamicZodForm from "./DynamicZodForm";
import { EvaluationManualIntegration } from "./EvaluationManualIntegration";
import { EvaluatorSelection, evaluatorTempNameMap } from "./EvaluatorSelection";
import { PreconditionsField } from "./PreconditionsField";
import { TryItOut } from "./TryItOut";

export interface CheckConfigFormData {
  name: string;
  checkType: EvaluatorTypes | undefined;
  sample: number;
  preconditions: CheckPreconditions;
  settings: Evaluators[EvaluatorTypes]["settings"];
  executionMode: EvaluationExecutionMode;
  storeSettingsOnCode: boolean;
  mappings: Record<string, string>;
}

interface CheckConfigFormProps {
  checkId?: string;
  defaultValues?: Partial<CheckConfigFormData>;
  onSubmit: (data: CheckConfigFormData) => Promise<void>;
  isLoading: boolean;
}

export default function CheckConfigForm({
  checkId,
  defaultValues,
  onSubmit,
  isLoading,
}: CheckConfigFormProps) {
  const { project } = useOrganizationTeamProject();
  const isNameAvailable = api.checks.isNameAvailable.useMutation();
  const [isNameAlreadyInUse, setIsNameAlreadyInUse] = useState(false);

  const validateNameUniqueness = async (name: string) => {
    const result = await isNameAvailable.mutateAsync({
      projectId: project?.id ?? "",
      name,
      checkId,
    });

    setIsNameAlreadyInUse(!result.available);

    return result.available;
  };

  const DEFAULT_MAPPINGS: CheckConfigFormData["mappings"] = {
    input: "trace.input",
    output: "trace.output",
    contexts: "trace.first_rag_context",
    expected_output: "metadata.expected_output",
    expected_contexts: "metadata.expected_contexts",
  };

  const MAPPING_OPTIONS = [
    { value: "trace.input", label: "trace.input" },
    { value: "trace.output", label: "trace.output" },
    { value: "trace.first_rag_context", label: "trace.first_rag_context" },
    { value: "metadata.expected_output", label: "metadata.expected_output" },
    {
      value: "metadata.expected_contexts",
      label: "metadata.expected_contexts",
    },
  ];

  if (defaultValues) {
    defaultValues.mappings = {
      ...DEFAULT_MAPPINGS,
      ...(defaultValues.mappings ?? {}),
    } as CheckConfigFormData["mappings"];
  }

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
          mappings: z.record(z.string(), z.string().optional()), // Allow any string key with optional string value
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
  const mappings = watch("mappings");

  const {
    fields: fieldsPrecondition,
    append: appendPrecondition,
    remove: removePrecondition,
  } = useFieldArray({
    control,
    name: "preconditions",
  });
  const evaluatorDefinition = checkType && getEvaluatorDefinitions(checkType);

  const slug = slugify(nameValue || "", {
    lower: true,
    strict: true,
  });

  const router = useRouter();
  const isChoosing = router.pathname.endsWith("/choose");

  const availableCustomEvaluators =
    api.evaluations.availableCustomEvaluators.useQuery(
      { projectId: project?.id ?? "" },
      { enabled: !!project }
    );

  const availableEvaluators = {
    ...AVAILABLE_EVALUATORS,
    ...Object.fromEntries(
      (availableCustomEvaluators.data ?? []).map((evaluator) => {
        const { inputs, outputs } = getInputsOutputs(
          JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))
            ?.edges as Edge[],
          JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))
            ?.nodes as JsonArray as unknown[] as Node[]
        );
        const requiredFields = inputs.map((input) => input.identifier);

        return [
          `custom/${evaluator.id}`,
          {
            name: evaluator.name,
            description: evaluator.description,
            category: "custom",
            isGuardrail: false,
            requiredFields: requiredFields,
            optionalFields: [],
            settings: {},
            result: {},
            envVars: [],
          },
        ];
      })
    ),
  };

  useEffect(() => {
    if (!checkType && !isChoosing) {
      void router.replace({
        pathname: router.pathname + "/choose",
        query: router.query,
      });
    }
  }, [checkType, isChoosing, router]);

  useEffect(() => {
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
      getEvaluatorDefaultSettings(availableEvaluators[checkType]),
      "settings"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkType, defaultValues?.checkType, defaultValues?.settings]);

  if (!availableCustomEvaluators.data) {
    return;
  }

  const runOn = (
    <Text color="gray.500" fontStyle="italic">
      This check will run on{" "}
      {sample >= 1
        ? "every message"
        : `${+(sample * 100).toFixed(2)}% of messages`}
      {preconditions?.length > 0 && " matching the preconditions"}
    </Text>
  );

  const accordionIndex = checkType?.startsWith("custom/") ? 0 : undefined;

  return (
    <FormProvider {...form}>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)} style={{ width: "100%" }}>
        {!checkType || isChoosing ? (
          <EvaluatorSelection form={form} />
        ) : (
          <VStack spacing={6} align="start" width="full">
            <Card width="full">
              <CardBody>
                <VStack spacing={0}>
                  <HorizontalFormControl
                    label="Evaluation Type"
                    helper="Select the evaluation to run"
                    isInvalid={!!errors.checkType}
                  >
                    <VStack align="start" width="full">
                      <HStack spacing={0}>
                        <Text>
                          {evaluatorTempNameMap[
                            availableEvaluators[checkType].name
                          ] ?? availableEvaluators[checkType].name}
                        </Text>
                        <Button
                          variant="link"
                          onClick={() => {
                            void router.push({
                              pathname: router.pathname + "/choose",
                              query: router.query,
                            });
                          }}
                          marginLeft={4}
                          fontWeight="normal"
                        >
                          (change)
                        </Button>
                      </HStack>
                      <Text fontSize={12} color="gray.500">
                        {availableEvaluators[checkType].description}
                      </Text>
                      {checkType.startsWith("legacy/") && (
                        <Alert status="warning" alignItems="start">
                          <AlertIcon />
                          <Text fontSize={13}>
                            You are using a legacy evaluator version, please
                            click the <b>change</b> button above to select a
                            newer version or a replacement for this evaluator.
                          </Text>
                        </Alert>
                      )}
                    </VStack>
                  </HorizontalFormControl>
                  <HorizontalFormControl
                    label="Name"
                    helper="Used to identify the check and call it from the API"
                    isInvalid={!!errors.name}
                    align="start"
                  >
                    <VStack spacing={2} align="start">
                      <Input
                        id="name"
                        {...register("name", {
                          required: true,
                        })}
                      />
                      {isNameAlreadyInUse && (
                        <Text color="red.500" fontSize={13}>
                          An evaluation with the same name already exists,
                          please choose a different name to have a different
                          slug identifier as well
                        </Text>
                      )}
                      <Text fontSize={12} paddingLeft={4}>
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
              </CardBody>
            </Card>

            <Card width="full" padding={0}>
              <CardBody padding={0}>
                <VStack paddingX={4} spacing={0}>
                  <HorizontalFormControl
                    label="Execution Mode"
                    helper="Configure when this evaluation is executed"
                    isInvalid={!!errors.executionMode}
                    align="start"
                    _last={{ borderBottomWidth: "1px" }}
                  >
                    <Select {...register("executionMode")} required>
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
                    </Select>
                  </HorizontalFormControl>
                  {executionMode !== EvaluationExecutionMode.ON_MESSAGE && (
                    <EvaluationManualIntegration
                      slug={slug}
                      evaluatorDefinition={availableEvaluators[checkType]}
                      form={form}
                    />
                  )}
                </VStack>

                {executionMode === EvaluationExecutionMode.ON_MESSAGE && (
                  <Accordion
                    defaultIndex={accordionIndex}
                    allowToggle
                    padding={0}
                  >
                    <AccordionItem border="none">
                      <AccordionButton paddingY={6}>
                        <Box as="span" flex="1" textAlign="left">
                          <FormControl>
                            <VStack align="start" spacing={1}>
                              <FormLabel margin={0}>
                                Execution Settings
                              </FormLabel>
                              <FormHelperText margin={0} fontSize={13}>
                                Configure how and when this evaluation is
                                executed when a new message arrives
                              </FormHelperText>
                            </VStack>
                          </FormControl>
                        </Box>
                        <AccordionIcon />
                      </AccordionButton>
                      <AccordionPanel paddingTop={2}>
                        <HorizontalFormControl
                          label="Mappings"
                          helper="Map which fields from the trace will be used to run the evaluation"
                        >
                          <MappingsFields
                            register={register}
                            mappingOptions={MAPPING_OPTIONS}
                            defaultValues={
                              defaultValues?.mappings ?? DEFAULT_MAPPINGS
                            }
                            optionalFields={
                              availableEvaluators[checkType].optionalFields
                            }
                            requiredFields={
                              availableEvaluators[checkType].requiredFields
                            }
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
                          isInvalid={!!errors.sample}
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
                                  <Tooltip label="You can use this to save costs on expensive checks if you have too many messages incomming. From 0.01 to run on 1% of the messages to 1.0 to run on 100% of the messages">
                                    <HelpCircle width="14px" />
                                  </Tooltip>
                                </HStack>
                                {runOn}
                              </VStack>
                            )}
                          />
                        </HorizontalFormControl>
                      </AccordionPanel>
                    </AccordionItem>
                  </Accordion>
                )}
              </CardBody>
            </Card>

            <HStack width="full">
              <Spacer />
              <Tooltip
                label={
                  storeSettingsOnCode
                    ? 'You checked the "Store the settings on code" option, so the evaluation is configured directly on your codebase, saving is disabled'
                    : undefined
                }
              >
                <Button
                  colorScheme="orange"
                  type="submit"
                  minWidth="92px"
                  isLoading={isLoading}
                  isDisabled={storeSettingsOnCode}
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

const MappingsFields = ({
  register,
  mappingOptions,
  optionalFields,
  requiredFields,
  defaultValues,
}: {
  register: UseFormRegister<CheckConfigFormData>;
  mappingOptions: { value: string; label: string }[];
  optionalFields: string[];
  requiredFields: string[];
  defaultValues: CheckConfigFormData["mappings"];
}) => {
  return (
    <>
      <VStack spacing={2} align="start" width="full">
        {requiredFields.length > 0 && (
          <>
            {requiredFields.map((field) => (
              <HStack width="full" key={field}>
                <Select
                  maxWidth="50%"
                  defaultValue={defaultValues[field]}
                  {...register(`mappings.${field}`)}
                >
                  {mappingOptions.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <ArrowRight />
                <Text>{field} (required)</Text>
              </HStack>
            ))}
          </>
        )}
        {optionalFields.length > 0 && (
          <>
            {optionalFields.map((field) => (
              <HStack width="full" key={field}>
                <Select
                  maxWidth="50%"
                  defaultValue={defaultValues[field]}
                  {...register(`mappings.${field}`)}
                >
                  <option value="">(empty)</option>
                  {mappingOptions.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <ArrowRight />
                <Text>{field} (optional)</Text>
              </HStack>
            ))}
          </>
        )}
      </VStack>
    </>
  );
};
