import { checkPreconditionsSchema } from "../../../../../server/evaluations/types.generated";

import {
  Accordion,
  HStack,
  Input,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { HelpCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { LuActivity, LuCode, LuShield } from "react-icons/lu";
import { useDebounceCallback } from "usehooks-ts";
import { z } from "zod";
import { useShallow } from "zustand/react/shallow";
import type { CheckPreconditions } from "../../../../../server/evaluations/types";
import type { CheckConfigFormData } from "../../../../checks/CheckConfigForm";
import { PreconditionsField } from "../../../../checks/PreconditionsField";
import { HorizontalFormControl } from "../../../../HorizontalFormControl";
import { Tooltip } from "../../../../ui/tooltip";
import { StepAccordion } from "../../components/StepAccordion";
import { StepRadio } from "../../components/StepButton";
import {
  EXECUTION_METHODS,
  useEvaluationWizardStore,
} from "../../hooks/useEvaluationWizardStore";
import { useAnimatedFocusElementById } from "../../../../../hooks/useAnimatedFocusElementById";

export function RealTimeExecutionStep() {
  const { executionMethod, setWizardState, realTimeExecution } =
    useEvaluationWizardStore(
      useShallow(({ wizardState, setWizardState }) => ({
        executionMethod: wizardState.executionMethod,
        realTimeExecution: wizardState.realTimeExecution,
        setWizardState,
      }))
    );

  const [accordeonValue, setAccordeonValue] = useState(["execution-method"]);

  const focusElementById = useAnimatedFocusElementById();

  const handleRealTimeExecutionMethodSelect = (
    executionMethod:
      | "realtime_on_message"
      | "realtime_guardrail"
      | "realtime_manually"
  ) => {
    setWizardState({
      executionMethod,
    });
    setTimeout(() => {
      if (executionMethod === "realtime_on_message") {
        setAccordeonValue(["execution-settings"]);
      }
    }, 300);
    focusElementById("js-next-step-button");
  };

  const form = useForm<CheckConfigFormData>({
    defaultValues: {
      sample: 1,
      preconditions: [],
      ...(realTimeExecution ?? {}),
    },
    resolver: (data, ...args) => {
      return zodResolver(
        z.object({
          sample: z.number().min(0.01).max(1),
          preconditions: checkPreconditionsSchema,
        })
      )(data, ...args);
    },
  });

  const [skipSubmit, setSkipSubmit] = useState(false);

  const {
    fields: fieldsPrecondition,
    append: appendPrecondition_,
    remove: removePrecondition,
  } = useFieldArray({
    control: form.control,
    name: "preconditions",
  });

  const appendPrecondition = useCallback(
    (value: any) => {
      setSkipSubmit(true);
      appendPrecondition_(value);
      setTimeout(() => {
        setSkipSubmit(false);
      }, 500);
    },
    [appendPrecondition_, setSkipSubmit]
  );

  const preconditions = form.watch("preconditions");
  const sample = form.watch("sample");

  const runOn = (
    <Text color="gray.500" fontStyle="italic">
      This evaluation will run on{" "}
      {sample >= 1
        ? "every message"
        : `${+(sample * 100).toFixed(2)}% of messages`}
      {preconditions.length > 0 && " matching the preconditions"}
    </Text>
  );

  const onSubmit = useCallback(
    (data: { sample?: number; preconditions?: CheckPreconditions }) => {
      if (!executionMethod) return;

      setWizardState({
        realTimeExecution: {
          sample: data.sample,
          preconditions: data.preconditions,
        },
      });
    },
    [executionMethod, setWizardState]
  );

  const debouncedSubmit = useDebounceCallback(() => {
    void form.handleSubmit(onSubmit)();
  }, 500);

  useEffect(() => {
    const subscription = form.watch(() => {
      if (!skipSubmit) {
        debouncedSubmit();
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, skipSubmit]);

  return (
    <Accordion.Root
      value={accordeonValue}
      onValueChange={(e) => setAccordeonValue(e.value)}
      multiple={false}
      collapsible
      width="full"
      variant="plain"
    >
      <VStack width="full" gap={3}>
        <StepAccordion
          value="execution-method"
          width="full"
          borderColor="orange.400"
          title="Execution Method"
          showTrigger={executionMethod === "realtime_on_message"}
        >
          <RadioCard.Root
            variant="outline"
            colorPalette="orange"
            value={executionMethod}
            onValueChange={(e) =>
              // TODO: Isn't this redundant?
              handleRealTimeExecutionMethodSelect(
                e.value as
                  | "realtime_on_message"
                  | "realtime_guardrail"
                  | "realtime_manually"
              )
            }
            paddingBottom={1}
          >
            <StepRadio
              value="realtime_on_message"
              title={EXECUTION_METHODS.realtime_on_message}
              description="Run the evaluation as a monitoring system, as soon as a new trace is received"
              icon={<LuActivity />}
              onClick={() =>
                handleRealTimeExecutionMethodSelect("realtime_on_message")
              }
            />
            <StepRadio
              value="realtime_guardrail"
              title={EXECUTION_METHODS.realtime_guardrail}
              description="Run the evaluation as a guardrail in the middle of the workflow, stopping harmful messages"
              icon={<LuShield />}
              onClick={() =>
                handleRealTimeExecutionMethodSelect("realtime_guardrail")
              }
            />
            <StepRadio
              value="realtime_manually"
              title={EXECUTION_METHODS.realtime_manually}
              description="Integrate the evaluation manually in your code, so you can decide when and where to run it"
              icon={<LuCode />}
              onClick={() =>
                handleRealTimeExecutionMethodSelect("realtime_manually")
              }
            />
          </RadioCard.Root>
        </StepAccordion>
        <StepAccordion
          value="execution-settings"
          width="full"
          borderColor="orange.400"
          title="Execution Settings"
          showTrigger={executionMethod === "realtime_on_message"}
        >
          <VStack align="start" paddingBottom={5} width="full" gap={4}>
            {executionMethod === "realtime_on_message" && (
              <>
                <FormProvider {...form}>
                  <PreconditionsField
                    label={
                      <>
                        Preconditions (Optional)
                        <Tooltip content="Conditions that must be met for this check to run">
                          <HelpCircle width="14px" />
                        </Tooltip>
                      </>
                    }
                    helper={null}
                    runOn={
                      sample == 1 ? (
                        runOn
                      ) : (
                        <Text color="gray.500" fontStyle="italic">
                          No preconditions defined
                        </Text>
                      )
                    }
                    append={appendPrecondition}
                    remove={removePrecondition}
                    fields={fieldsPrecondition}
                  />
                </FormProvider>
                <HorizontalFormControl
                  label={
                    <HStack paddingTop={2}>
                      Sampling (Optional)
                      <Tooltip content="You can use this to save costs on expensive evaluations if you have too many messages incomming. From 0.01 to run on 1% of the messages to 1.0 to run on 100% of the messages">
                        <HelpCircle width="14px" />
                      </Tooltip>
                    </HStack>
                  }
                  helper={""}
                  invalid={!!form.formState.errors.sample}
                  align="start"
                >
                  <Controller
                    control={form.control}
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
                            onChange={(e) => field.onChange(+e.target.value)}
                          />
                        </HStack>
                        {runOn}
                      </VStack>
                    )}
                  />
                </HorizontalFormControl>
              </>
            )}
          </VStack>
        </StepAccordion>
      </VStack>
    </Accordion.Root>
  );
}
