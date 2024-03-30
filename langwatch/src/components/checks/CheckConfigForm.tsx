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
  CardHeader,
  HStack,
  Heading,
  Input,
  Skeleton,
  Spacer,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { HelpCircle, Play, RefreshCw } from "react-feather";
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
  type UseFormReturn,
} from "react-hook-form";
import slugify from "slugify";
import { z } from "zod";
import type { CheckPreconditions } from "../../trace_checks/types";
import { checkPreconditionsSchema } from "../../trace_checks/types.generated";
import { HorizontalFormControl } from "../HorizontalFormControl";
import DynamicZodForm from "./DynamicZodForm";
import { PreconditionsField } from "./PreconditionsField";
import {
  getEvaluatorDefaultSettings,
  getEvaluatorDefinitions,
} from "../../trace_checks/getEvaluator";
import { useRouter } from "next/router";
import {
  evaluatorTypesSchema,
  evaluatorsSchema,
} from "../../trace_checks/evaluators.zod.generated";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  type Evaluators,
} from "../../trace_checks/evaluators.generated";
import { EvaluatorSelection } from "./EvaluatorSelection";
import { usePeriodSelector, PeriodSelector } from "../PeriodSelector";
import { FilterToggle } from "../filters/FilterToggle";
import { FilterSidebar } from "../filters/FilterSidebar";
import { api } from "../../utils/api";
import { useFilterParams } from "../../hooks/useFilterParams";
import { TraceDeatilsDrawer } from "../TraceDeatilsDrawer";

export interface CheckConfigFormData {
  name: string;
  checkType: EvaluatorTypes | undefined;
  sample: number;
  preconditions: CheckPreconditions;
  settings: Evaluators[EvaluatorTypes]["settings"];
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
    if (!nameValue && defaultName && checkType !== "custom/basic") {
      form.setValue("name", defaultName);
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
  }, [
    checkType,
    defaultValues?.checkType,
    defaultValues?.settings,
    form,
    nameValue,
  ]);

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

function TryItOut({
  form,
}: {
  form: UseFormReturn<CheckConfigFormData, any, undefined>;
}) {
  const { watch } = form;

  const checkType = watch("checkType");
  const evaluation = checkType && getEvaluatorDefinitions(checkType);

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  const { filterParams, queryOpts } = useFilterParams();
  const [openTraceDrawer, setOpenTraceDrawer] = useState<string | undefined>();
  const [randomSeed, setRandomSeed] = useState<number>(Math.random() * 1000);

  const traceGroups = api.traces.getAllForProject.useQuery(
    {
      ...filterParams,
      // query: getSingleQueryParam(router.query.query),
      groupBy: "none",
      pageSize: 10,
      sortBy: `random.${randomSeed}`,
    },
    queryOpts
  );

  return (
    <VStack width="full" spacing={6} marginTop={6}>
      <HStack width="full" align="end">
        <Heading as="h2" size="lg" textAlign="center" paddingTop={4}>
          Try it out
        </Heading>
        <Spacer />
        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
        <FilterToggle />
      </HStack>
      <HStack width="full" align="start" spacing={6} paddingBottom={6}>
        <Card width="full" minHeight="400px">
          <CardHeader>
            <HStack spacing={4}>
              <Text fontWeight="500">
                {traceGroups.isLoading
                  ? "Fetching samples..."
                  : `Fetched ${
                      (traceGroups.data?.groups ?? []).length
                    } random sample messages`}
              </Text>
              <Spacer />
              <Button
                onClick={() => setRandomSeed(Math.random() * 1000)}
                leftIcon={
                  <RefreshCw
                    size={16}
                    className={
                      traceGroups.isLoading
                        ? "refresh-icon animation-spinning"
                        : "refresh-icon"
                    }
                  />
                }
                disabled={traceGroups.isLoading}
                size="sm"
              >
                Shuffle
              </Button>
              <Button
                leftIcon={<Play size={16} />}
                colorScheme="orange"
                size="sm"
              >
                Run on samples
              </Button>
            </HStack>
          </CardHeader>
          <CardBody paddingX={2} paddingTop={0}>
            <VStack width="full" align="start" spacing={6}>
              <TableContainer>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      <Th width="240px">Timestamp</Th>
                      <Th width="300px">Input</Th>
                      <Th width="300px">Output</Th>
                      {evaluation?.isGuardrail ? (
                        <Th>Passed</Th>
                      ) : (
                        <Th>Score</Th>
                      )}
                      <Th width="200px">Details</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {traceGroups.data?.groups.flatMap((traceGroup) =>
                      traceGroup.map((trace) => (
                        <Tr key={trace.trace_id} role="button" cursor="pointer">
                          <Td
                            maxWidth="240px"
                            onClick={() => setOpenTraceDrawer(trace.trace_id)}
                          >
                            {new Date(
                              trace.timestamps.started_at
                            ).toLocaleString()}
                          </Td>
                          <Td
                            maxWidth="300px"
                            onClick={() => setOpenTraceDrawer(trace.trace_id)}
                          >
                            <Tooltip label={trace.input.value}>
                              <Text
                                noOfLines={1}
                                wordBreak="break-all"
                                display="block"
                              >
                                {trace.input.value}
                              </Text>
                            </Tooltip>
                          </Td>
                          {trace.error ? (
                            <Td
                              onClick={() => setOpenTraceDrawer(trace.trace_id)}
                            >
                              <Text
                                noOfLines={1}
                                maxWidth="300px"
                                display="block"
                                color="red.400"
                              >
                                {trace.error.message}
                              </Text>
                            </Td>
                          ) : (
                            <Td
                              onClick={() => setOpenTraceDrawer(trace.trace_id)}
                            >
                              <Tooltip label={trace.output?.value}>
                                <Text
                                  noOfLines={1}
                                  display="block"
                                  maxWidth="250px"
                                >
                                  {trace.output?.value}
                                </Text>
                              </Tooltip>
                            </Td>
                          )}
                          {evaluation?.isGuardrail ? <Td></Td> : <Td></Td>}
                          <Td></Td>
                        </Tr>
                      ))
                    )}
                    {traceGroups.isLoading &&
                      Array.from({ length: 3 }).map((_, i) => (
                        <Tr key={i}>
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Td key={i}>
                              <Skeleton height="20px" />
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    {traceGroups.isFetched &&
                      traceGroups.data?.groups.length === 0 && (
                        <Tr>
                          <Td colSpan={5}>
                            No messages found, try selecting different filters
                            and dates
                          </Td>
                        </Tr>
                      )}
                  </Tbody>
                </Table>
              </TableContainer>
            </VStack>
          </CardBody>
        </Card>
        <FilterSidebar />
        {openTraceDrawer && (
          <TraceDeatilsDrawer
            isDrawerOpen={true}
            traceId={openTraceDrawer}
            closeDrawer={() => setOpenTraceDrawer(undefined)}
          />
        )}
      </HStack>
    </VStack>
  );
}
