import {
  Button,
  Card,
  CardBody,
  HStack,
  Input,
  Select,
  Spacer,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { HelpCircle } from "react-feather";
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
} from "react-hook-form";
import slugify from "slugify";
import { z } from "zod";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
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
import { EvaluatorSelection, evaluatorTempNameMap } from "./EvaluatorSelection";
import { EvaluationManualIntegration } from "./EvaluationManualIntegration";
import { PreconditionsField } from "./PreconditionsField";
import { TryItOut } from "./TryItOut";
import { EvaluationExecutionMode } from "@prisma/client";

export interface CheckConfigFormData {
  name: string;
  checkType: EvaluatorTypes | undefined;
  sample: number;
  preconditions: CheckPreconditions;
  settings: Evaluators[EvaluatorTypes]["settings"];
  executionMode: EvaluationExecutionMode;
  storeSettingsOnCode: boolean;
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

  const form = useForm<CheckConfigFormData>({
    defaultValues,
    resolver: (data, ...args) => {
      return zodResolver(
        z.object({
          name: z.string().min(1).max(255).refine(validateNameUniqueness),
          checkType: evaluatorTypesSchema,
          sample: z.number().min(0.01).max(1),
          preconditions: checkPreconditionsSchema,
          settings:
            evaluatorsSchema.shape[data.checkType ?? "langevals/basic"].shape
              .settings,
          executionMode: z
            .enum([
              EvaluationExecutionMode.ON_MESSAGE,
              EvaluationExecutionMode.AS_GUARDRAIL,
              EvaluationExecutionMode.MANUALLY,
            ])
            .optional(),
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
    const allDefaultNames = Object.values(AVAILABLE_EVALUATORS).map(
      (evaluator) => evaluatorTempNameMap[evaluator.name] ?? evaluator.name
    );
    if (!nameValue || allDefaultNames.includes(nameValue)) {
      form.setValue(
        "name",
        checkType.includes("custom") ? "" : defaultName ?? ""
      );
    }

    const evaluator = AVAILABLE_EVALUATORS[checkType];

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

    setDefaultSettings(getEvaluatorDefaultSettings(evaluator), "settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkType, defaultValues?.checkType, defaultValues?.settings]);

  const runOn = (
    <Text color="gray.500" fontStyle="italic">
      This check will run on{" "}
      {sample >= 1
        ? "every message"
        : `${+(sample * 100).toFixed(2)}% of messages`}
      {preconditions?.length > 0 && " matching the preconditions"}
    </Text>
  );

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
                <VStack spacing={4}>
                  <HorizontalFormControl
                    label="Evaluation Type"
                    helper="Select the evaluation to run"
                    isInvalid={!!errors.checkType}
                  >
                    {evaluatorTempNameMap[
                      AVAILABLE_EVALUATORS[checkType].name
                    ] ?? AVAILABLE_EVALUATORS[checkType].name}{" "}
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
                    />
                  )}

                  <HorizontalFormControl
                    label="Execution Mode"
                    helper="Configure when this evaluation is executed"
                    isInvalid={!!errors.executionMode}
                    align="start"
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

                  {executionMode === EvaluationExecutionMode.ON_MESSAGE && (
                    <>
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
                    </>
                  )}

                  {executionMode !== EvaluationExecutionMode.ON_MESSAGE && (
                    <EvaluationManualIntegration
                      slug={slug}
                      evaluatorDefinition={evaluatorDefinition!}
                      form={form}
                    />
                  )}
                </VStack>
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
