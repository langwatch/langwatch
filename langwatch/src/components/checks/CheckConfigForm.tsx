import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  Card,
  CardBody,
  HStack,
  Input,
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
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  type Evaluators,
} from "../../trace_checks/evaluators.generated";
import {
  evaluatorTypesSchema,
  evaluatorsSchema,
} from "../../trace_checks/evaluators.zod.generated";
import {
  getEvaluatorDefaultSettings,
  getEvaluatorDefinitions,
} from "../../trace_checks/getEvaluator";
import type { CheckPreconditions } from "../../trace_checks/types";
import { checkPreconditionsSchema } from "../../trace_checks/types.generated";
import { HorizontalFormControl } from "../HorizontalFormControl";
import DynamicZodForm from "./DynamicZodForm";
import { EvaluatorSelection } from "./EvaluatorSelection";
import { PreconditionsField } from "./PreconditionsField";
import { TryItOut } from "./TryItOut";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export interface CheckConfigFormData {
  name: string;
  checkType: EvaluatorTypes | undefined;
  sample: number;
  preconditions: CheckPreconditions;
  settings: Evaluators[EvaluatorTypes]["settings"];
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
            evaluatorsSchema.shape[data.checkType ?? "custom/basic"].shape
              .settings,
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
  const {
    fields: fieldsPrecondition,
    append: appendPrecondition,
    remove: removePrecondition,
  } = useFieldArray({
    control,
    name: "preconditions",
  });
  const check = checkType && getEvaluatorDefinitions(checkType);

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

    const defaultName = getEvaluatorDefinitions(checkType)?.name;
    const allDefaultNames = Object.values(AVAILABLE_EVALUATORS).map(
      (evaluator) => evaluator.name
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
                    {AVAILABLE_EVALUATORS[checkType].name}{" "}
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
                        {slugify(nameValue || "", {
                          lower: true,
                          strict: true,
                        })}
                      </Text>
                    </VStack>
                  </HorizontalFormControl>
                  <PreconditionsField
                    runOn={
                      preconditions?.length === 0 &&
                      !check?.requiredFields.includes("contexts") ? (
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
                      schema={evaluatorsSchema.shape[checkType].shape.settings}
                      checkType={checkType}
                      prefix="settings"
                      errors={errors.settings}
                    />
                  )}
                  <Accordion
                    defaultIndex={
                      (defaultValues?.sample ?? 1) < 1 ? 0 : undefined
                    }
                    allowToggle={true}
                    width="full"
                    boxShadow="none"
                    border="none"
                  >
                    <AccordionItem width="full" border="none" padding={0}>
                      <AccordionButton
                        border="none"
                        paddingX={5}
                        paddingY={5}
                        marginX={-5}
                        marginY={-5}
                        width="calc(100% + 40px)"
                      >
                        <Box flex="1" textAlign="left" fontWeight={500}>
                          Advanced
                        </Box>
                        <AccordionIcon color="gray.400" />
                      </AccordionButton>
                      <AccordionPanel width="full" paddingX={0} marginTop={6}>
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
                </VStack>
              </CardBody>
            </Card>
            <HStack width="full">
              <Spacer />
              <Button
                colorScheme="orange"
                type="submit"
                minWidth="92px"
                isLoading={isLoading}
              >
                Save
              </Button>
            </HStack>
            <TryItOut form={form} />
          </VStack>
        )}
      </form>
    </FormProvider>
  );
}
