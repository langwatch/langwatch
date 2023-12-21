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
  Grid,
  GridItem,
  HStack,
  Heading,
  Input,
  Spacer,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { HelpCircle } from "react-feather";
import { Controller, FormProvider, useForm } from "react-hook-form";
import slugify from "slugify";
import { z } from "zod";
import type {
  CheckPreconditions,
  CheckTypes,
  Checks,
} from "../../trace_checks/types";
import {
  checkPreconditionsSchema,
  checkTypesSchema,
  checksSchema,
} from "../../trace_checks/types.generated";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { CustomRuleField } from "./CustomRuleField";
import DynamicZodForm from "./DynamicZodForm";
import { PreconditionsField } from "./PreconditionsField";
import { AVAILABLE_TRACE_CHECKS } from "../../trace_checks/frontend/registry";

const defaultParametersMap: {
  [K in CheckTypes]: Checks[K]["parameters"];
} = {
  pii_check: {
    infoTypes: {
      phoneNumber: true,
      emailAddress: true,
      creditCardNumber: true,
      ibanCode: true,
      ipAddress: true,
      passport: true,
      vatNumber: true,
      medicalRecordNumber: true,
    },
    minLikelihood: "POSSIBLE",
    checkPiiInSpans: false,
  },
  custom: {
    rules: [
      {
        field: "output",
        rule: "not_contains",
        value: "",
        model: "gpt-4-1106-preview",
        ...({ failWhen: { condition: "<", amount: 0.7 } } as any),
      },
    ],
  },
  toxicity_check: {},
};

export interface CheckConfigFormData {
  name: string;
  checkType: CheckTypes | undefined;
  sample: number;
  preconditions: CheckPreconditions;
  parameters: Checks[CheckTypes]["parameters"];
}

interface CheckConfigFormProps {
  defaultValues?: Partial<CheckConfigFormData>;
  onSubmit: (data: CheckConfigFormData) => Promise<void>;
  isLoading: boolean;
}

export default function CheckConfigForm({
  defaultValues,
  onSubmit,
  isLoading,
}: CheckConfigFormProps) {
  const form = useForm<CheckConfigFormData>({
    defaultValues,
    resolver: (data, ...args) => {
      return zodResolver(
        z.object({
          name: z.string().min(1).max(255),
          checkType: checkTypesSchema,
          sample: z.number().min(0.01).max(1),
          preconditions: checkPreconditionsSchema,
          parameters:
            checksSchema.shape[data.checkType ?? "custom"].shape.parameters,
        })
      )(data, ...args);
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

  useEffect(() => {
    if (defaultValues?.parameters && defaultValues.checkType === checkType)
      return;

    if (!checkType) return;

    const defaultParameters = defaultParametersMap[checkType];

    const setDefaultParameters = (
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
          setDefaultParameters(value, `${prefix}.${key}`);
        } else {
          //@ts-ignore
          form.setValue(`${prefix}.${key}`, value);
        }
      });
    };

    setDefaultParameters(defaultParameters, "parameters");
  }, [checkType, defaultValues?.checkType, defaultValues?.parameters, form]);

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
        {!checkType ? (
          <Grid templateColumns="repeat(3, 1fr)" gap={6}>
            {Object.entries(AVAILABLE_TRACE_CHECKS).map(([key, check]) => (
              <GridItem
                key={key}
                width="full"
                background="white"
                padding={6}
                borderRadius={6}
                boxShadow="0px 4px 10px 0px rgba(0, 0, 0, 0.06)"
                cursor="pointer"
                role="button"
                _hover={{
                  background: "gray.200",
                }}
                onClick={() => {
                  form.setValue("checkType", key as CheckTypes);
                }}
              >
                <VStack align="start" spacing={4}>
                  <Heading as="h2" size="sm">
                    {check.name}
                  </Heading>
                  <Text>{check.description}</Text>
                </VStack>
              </GridItem>
            ))}
          </Grid>
        ) : (
          <VStack spacing={6} align="start" width="full">
            <Card width="full">
              <CardBody>
                <VStack spacing={4}>
                  <HorizontalFormControl
                    label="Check Type"
                    helper="Select the type of check"
                    isInvalid={!!errors.checkType}
                  >
                    {AVAILABLE_TRACE_CHECKS[checkType].name}
                    {" "}
                    <Button
                      variant="link"
                      onClick={() => {
                        form.setValue("checkType", undefined);
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
                        {...register("name", { required: true })}
                      />
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
                      preconditions?.length === 0 ? (
                        sample == 1 ? (
                          runOn
                        ) : (
                          <Text color="gray.500" fontStyle="italic">
                            No preconditions defined
                          </Text>
                        )
                      ) : null
                    }
                  />
                  {checkType === "custom" && <CustomRuleField />}
                  {checkType &&
                    checkType !== "custom" &&
                    checksSchema.shape[checkType] && (
                      <DynamicZodForm
                        schema={checksSchema.shape[checkType].shape.parameters}
                        checkType={checkType}
                        prefix="parameters"
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
                          isInvalid={!!errors.name}
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
          </VStack>
        )}
      </form>
    </FormProvider>
  );
}
