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
  Center,
  Container,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  Heading,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Select,
  Spacer,
  Switch,
  Text,
  VStack,
  useTheme,
  useDisclosure,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Textarea,
} from "@chakra-ui/react";

import {
  Select as MultiSelect,
  chakraComponents,
  type SingleValue,
} from "chakra-react-select";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlignLeft,
  BarChart2,
  Check,
  GitBranch,
  MoreVertical,
  PieChart,
  Trash,
  TrendingUp,
  Triangle,
} from "react-feather";
import {
  Controller,
  useFieldArray,
  useForm,
  type ControllerRenderProps,
  type FieldArrayWithId,
  type FieldValues,
  type Path,
  type UseFieldArrayReturn,
} from "react-hook-form";
import { useDebounceValue } from "usehooks-ts";
import { DashboardLayout } from "../../../../components/DashboardLayout";
import {
  FilterToggle,
  useFilterToggle,
} from "../../../../components/filters/FilterToggle";
import { FilterSidebar } from "../../../../components/filters/FilterSidebar";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../../../components/PeriodSelector";
import {
  CustomGraph,
  summaryGraphTypes,
  type CustomGraphInput,
} from "../../../../components/analytics/CustomGraph";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import {
  analyticsGroups,
  analyticsMetrics,
  analyticsPipelines,
  getGroup,
  getMetric,
  metricAggregations,
  pipelineAggregations,
  type FlattenAnalyticsGroupsEnum,
  type FlattenAnalyticsMetricsEnum,
} from "../../../../server/analytics/registry";
import type {
  AggregationTypes,
  AnalyticsGroup,
  AnalyticsMetric,
  PipelineAggregationTypes,
  PipelineFields,
  SharedFiltersInput,
} from "../../../../server/analytics/types";
import type { FilterField } from "../../../../server/filters/types";
import { api } from "../../../../utils/api";
import {
  rotatingColors,
  type RotatingColorSet,
} from "../../../../utils/rotatingColors";
import {
  camelCaseToTitleCase,
  uppercaseFirstLetterLowerCaseRest,
} from "../../../../utils/stringCasing";
import { useRouter } from "next/router";
import { useFilterParams } from "~/hooks/useFilterParams";
import { RenderCode } from "~/components/code/RenderCode";

export interface CustomGraphFormData {
  title?: string;
  startDate?: Date;
  endDate?: Date;
  graphType?: {
    label: string;
    value: CustomGraphInput["graphType"];
    icon: React.ReactNode;
  };
  series: {
    name: string;
    colorSet: RotatingColorSet;
    metric: FlattenAnalyticsMetricsEnum;
    key?: string;
    subkey?: string;
    aggregation: AggregationTypes;
    pipeline: {
      field: PipelineFields | "";
      aggregation: PipelineAggregationTypes;
    };
  }[];
  groupBy?: FlattenAnalyticsGroupsEnum | "";
  includePrevious: boolean;
  timeScale: "full" | number;
  connected?: boolean;
}

export type CustomAPICallData = Omit<SharedFiltersInput, "projectId"> & {
  series: {
    name: string;
    metric: FlattenAnalyticsMetricsEnum;
    key?: string;
    subkey?: string;
    aggregation: AggregationTypes;
    pipeline: {
      field: PipelineFields | "";
      aggregation: PipelineAggregationTypes;
    };
  }[];
  groupBy?: FlattenAnalyticsGroupsEnum;
  timeScale: number | "full";
};

const chartOptions: Required<CustomGraphFormData>["graphType"][] = [
  {
    label: "Summary",
    value: "summary",
    icon: <AlignLeft />,
  },
  {
    label: "Line Chart",
    value: "line",
    icon: <TrendingUp />,
  },
  {
    label: "Area Chart",
    value: "area",
    icon: <Triangle />,
  },
  {
    label: "Stacked Area Chart",
    value: "stacked_area",
    icon: <Triangle />,
  },
  {
    label: "Bar Chart",
    value: "bar",
    icon: <BarChart2 />,
  },
  {
    label: "Stacked Bar Chart",
    value: "stacked_bar",
    icon: <BarChart2 />,
  },
  {
    label: "Horizontal Bar Chart",
    value: "horizontal_bar",
    icon: (
      <BarChart2
        style={{
          transform: "rotate(90deg)",
        }}
      />
    ),
  },
  {
    label: "Scatter Chart",
    value: "scatter",
    icon: <GitBranch />,
  },
  {
    label: "Pie Chart",
    value: "pie",
    icon: <PieChart />,
  },
  {
    label: "Donut Chart",
    value: "donnut",
    icon: <PieChart />,
  },
];

const defaultValues: CustomGraphFormData = {
  title: "Messages count",
  graphType: chartOptions[1]!,
  series: [
    {
      name: "Messages count",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "",
        aggregation: "avg",
      },
    },
  ],
  groupBy: undefined,
  timeScale: 1,
  includePrevious: true,
};

export default function AnalyticsCustomGraph({
  customId,
  graph,
  name,
}: {
  customId?: string;
  graph?: CustomGraphInput;
  name?: string;
}) {
  const jsonModal = useDisclosure();
  const apiModal = useDisclosure();
  const { filterParams } = useFilterParams();

  let initialFormData: CustomGraphFormData | undefined;
  if (customId && graph) {
    initialFormData = customGraphInputToFormData(graph);
  }

  const form = useForm<CustomGraphFormData>({
    defaultValues: customId ? initialFormData : defaultValues,
  });

  useEffect(() => {
    if (name) {
      form.setValue("title", name);
    }
  }, [name, form]);

  const seriesFields = useFieldArray({
    control: form.control,
    name: "series",
  });
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();
  const { showFilters } = useFilterToggle();

  const formData = JSON.stringify(form.watch() ?? {});
  const [debouncedCustomGraphInput, setDebouncedCustomGraphInput] =
    useDebounceValue<CustomGraphInput | undefined>(undefined, 400);
  const [debouncedCustomAPIInput, setDebouncedCustomAPIInput] =
    useDebounceValue<CustomAPICallData | undefined>(undefined, 400);

  useEffect(() => {
    const parsedFormData = JSON.parse(formData) as CustomGraphFormData;

    const customGraphInput = customGraphFormToCustomGraphInput(parsedFormData);
    const apiJson = customAPIinput(parsedFormData, filterParams);
    if (
      typeof apiJson?.timeScale === "string" &&
      apiJson.timeScale !== "full"
    ) {
      apiJson.timeScale = parseInt(apiJson.timeScale);
    }
    setDebouncedCustomAPIInput(apiJson);
    setDebouncedCustomGraphInput(customGraphInput);
  }, [
    formData,
    filterParams,
    setDebouncedCustomAPIInput,
    setDebouncedCustomGraphInput,
  ]);

  return (
    <DashboardLayout>
      <Container maxWidth="1600" padding={6}>
        <VStack width="full" align="start" gap={6}>
          <HStack width="full" align="top">
            <Heading as={"h1"} size="lg" paddingTop={1}>
              Custom Graph
            </Heading>
            <Spacer />
            <FilterToggle />
            <PeriodSelector
              period={{ startDate, endDate }}
              setPeriod={setPeriod}
            />
          </HStack>
          <HStack width="full" align="start" minHeight="500px" gap={8}>
            <Card minWidth="480px" minHeight="560px">
              <CardBody>
                <CustomGraphForm
                  form={form}
                  seriesFields={seriesFields}
                  customId={customId}
                />
              </CardBody>
            </Card>
            <Card width="full">
              <CardHeader paddingTop={3} paddingBottom={1} paddingX={3}>
                <Flex>
                  <Input
                    {...form.control.register(`title`)}
                    border="none"
                    paddingX={2}
                    fontWeight="bold"
                  />
                  <Menu>
                    <MenuButton as={Button} variant={"ghost"}>
                      <MoreVertical />
                    </MenuButton>
                    <MenuList>
                      {/* <MenuItem onClick={jsonModal.onOpen}>Show JSON</MenuItem> */}
                      <MenuItem onClick={apiModal.onOpen}>Show API</MenuItem>
                    </MenuList>
                  </Menu>
                </Flex>
              </CardHeader>
              <CardBody>
                {debouncedCustomGraphInput && (
                  <CustomGraph input={debouncedCustomGraphInput} />
                )}
              </CardBody>
            </Card>
            {showFilters && <FilterSidebar hideTopics={true} />}
          </HStack>
        </VStack>
      </Container>
      <Modal isOpen={jsonModal.isOpen} onClose={jsonModal.onClose} size={"2xl"}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Graph JSON</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Textarea rows={16}>
              {JSON.stringify(debouncedCustomGraphInput, null, 2)}
            </Textarea>
          </ModalBody>

          <ModalFooter></ModalFooter>
        </ModalContent>
      </Modal>
      <Modal isOpen={apiModal.isOpen} onClose={apiModal.onClose} size={"2xl"}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>JSON API</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text paddingBottom={8}>
              Incorporate the following JSON payload within the body of your
              HTTP POST request to access identical data tailored for the custom
              graphs.
            </Text>
            <Box padding={4} backgroundColor={"#272822"}>
              <RenderCode
                code={`# Set your API key and endpoint URL
API_KEY="your_langwatch_api_key"
ENDPOINT="https://app.langwatch.ai/api/analytics"

# Use curl to send the POST request, e.g.:
curl -X POST "$ENDPOINT" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
${JSON.stringify(debouncedCustomAPIInput, null, 2)}
EOF`}
                language="bash"
              />
            </Box>
          </ModalBody>

          <ModalFooter></ModalFooter>
        </ModalContent>
      </Modal>
    </DashboardLayout>
  );
}

const customGraphInputToFormData = (
  graphInput: CustomGraphInput
): CustomGraphFormData => {
  return {
    title: graphInput.graphId === "custom" ? undefined : graphInput.graphId,
    graphType: chartOptions.find(
      (option) => option.value === graphInput.graphType
    )!,
    series: graphInput.series.map((series) => ({
      name: series.name,
      colorSet: series.colorSet,
      metric: series.metric,
      key: series.key,
      subkey: series.subkey,
      aggregation: series.aggregation,
      pipeline:
        "pipeline" in series && series.pipeline
          ? {
              field: series.pipeline.field,
              aggregation: series.pipeline.aggregation,
            }
          : {
              field: "",
              aggregation: "avg",
            },
    })),
    groupBy: graphInput.groupBy ?? "",
    includePrevious: graphInput.includePrevious ?? true,
    timeScale: graphInput.timeScale ?? 1,
    connected: graphInput.connected,
  };
};

const customGraphFormToCustomGraphInput = (
  formData: CustomGraphFormData
): CustomGraphInput | undefined => {
  for (const series of formData.series) {
    const metric = getMetric(series.metric);
    if (metric.requiresKey && !metric.requiresKey.optional && !series.key) {
      return undefined;
    }
    if (metric.requiresSubkey && !series.subkey) {
      return undefined;
    }
  }

  return {
    graphId: "custom",
    graphType: formData.graphType!.value,
    series: formData.series.map((series) => {
      if (series.pipeline.field) {
        return {
          ...series,
          pipeline: {
            ...series.pipeline,
            field: series.pipeline.field,
          },
        };
      }
      return {
        name: series.name,
        colorSet: series.colorSet,
        metric: series.metric,
        aggregation: series.aggregation,
        key: series.key,
        subkey: series.subkey,
      };
    }),
    groupBy: formData.groupBy === "" ? undefined : formData.groupBy,
    includePrevious: formData.includePrevious,
    timeScale: formData.timeScale,
    connected: formData.connected,
    height: 550,
  };
};

const customAPIinput = (
  formData: CustomGraphFormData,
  filterParams: SharedFiltersInput
): CustomAPICallData | undefined => {
  for (const series of formData.series) {
    const metric = getMetric(series.metric);
    if (metric.requiresKey && !metric.requiresKey.optional && !series.key) {
      return undefined;
    }
    if (metric.requiresSubkey && !series.subkey) {
      return undefined;
    }
  }

  return {
    startDate: filterParams.startDate,
    endDate: filterParams.endDate,
    filters: filterParams.filters,
    series: formData.series.map((series) => {
      if (series.pipeline.field) {
        return {
          ...series,
          pipeline: {
            ...series.pipeline,
            field: series.pipeline.field,
          },
        };
      }
      return {
        metric: series.metric,
        aggregation: series.aggregation,
        key: series.key,
        subkey: series.subkey,
      };
    }) as CustomAPICallData["series"],
    groupBy: formData.groupBy === "" ? undefined : formData.groupBy,
    timeScale: formData.timeScale,
  };
};

function CustomGraphForm({
  form,
  seriesFields,
  customId,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  seriesFields: UseFieldArrayReturn<CustomGraphFormData, "series", "id">;
  customId?: string;
}) {
  const [expandedSeries, setExpandedSeries] = useState<number | number[]>([0]);
  const groupByField = form.control.register("groupBy");
  const graphType = form.watch("graphType");
  const groupBy = form.watch("groupBy");
  const title = form.watch("title");

  const joinedSeriesNames = form
    .watch()
    .series.map((s) => s.name)
    .join(", ");

  useEffect(() => {
    if (!form.getFieldState("title")?.isTouched || !title) {
      let suggestedTitle = joinedSeriesNames.replace(/,([^,]*)$/, " and$1");

      if (groupBy) {
        suggestedTitle += ` per ${getGroup(groupBy).label}`;
      }

      form.resetField("title", {
        defaultValue: uppercaseFirstLetterLowerCaseRest(suggestedTitle),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, groupBy, joinedSeriesNames]);

  const addNewGraph = api.graphs.create.useMutation();
  const updateGraphById = api.graphs.updateById.useMutation();
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const addGraph = () => {
    const graphName = form.getValues("title");
    const graphJson = customGraphFormToCustomGraphInput(form.getValues());
    if (graphJson && graphJson.hasOwnProperty("height")) {
      graphJson.height = 300;
    }

    addNewGraph.mutate(
      {
        projectId: project?.id ?? "",
        name: graphName ?? "",
        graph: JSON.stringify(graphJson),
      },
      {
        onSuccess: () => {
          void router.push(`/${project?.slug}/analytics/reports`);
        },
      }
    );
  };

  const updateGraph = () => {
    const graphName = form.getValues("title");
    const graphJson = customGraphFormToCustomGraphInput(form.getValues());
    updateGraphById.mutate(
      {
        projectId: project?.id ?? "",
        name: graphName ?? "",
        graphId: customId ?? "",
        graph: JSON.stringify(graphJson),
      },
      {
        onSuccess: () => {
          void router.push(`/${project?.slug}/analytics/reports`);
        },
      }
    );
  };

  return (
    <VStack width="full" align="start" gap={4} maxWidth="500px">
      <FormControl>
        <FormLabel>Graph Type</FormLabel>
        <GraphTypeField form={form} />
      </FormControl>
      {(!graphType || !summaryGraphTypes.includes(graphType.value)) && (
        <FormControl>
          <FormLabel>Time Scale</FormLabel>

          <Select
            {...form.control.register("timeScale")}
            minWidth="fit-content"
          >
            <option value={"full"}>Full Period</option>
            <option value={1}>Daily</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={356}>365 days</option>
          </Select>
        </FormControl>
      )}
      {graphType?.value === "scatter" && (
        <FormControl>
          <Controller
            control={form.control}
            name="connected"
            defaultValue={false}
            render={({ field: { onChange, value } }) => (
              <Switch onChange={onChange} isChecked={value}>
                Connect dots
              </Switch>
            )}
          />
        </FormControl>
      )}
      <FormControl>
        <FormLabel fontSize={16}>Series</FormLabel>
        <Accordion
          width="full"
          allowMultiple={true}
          index={expandedSeries}
          onChange={(index) => setExpandedSeries(index)}
        >
          {seriesFields.fields.map((field, index) => (
            <SeriesFieldItem
              key={field.id}
              form={form}
              field={field}
              index={index}
              seriesFields={seriesFields}
              setExpandedSeries={setExpandedSeries}
            />
          ))}
        </Accordion>
        <Button
          onClick={() => {
            const index = seriesFields.fields.length;
            seriesFields.append(
              {
                name: "Users count",
                colorSet: "blueTones",
                metric: "metadata.user_id",
                aggregation: "cardinality",
                pipeline: {
                  field: "",
                  aggregation: "avg",
                },
              },
              { shouldFocus: false }
            );
            setTimeout(() => {
              form.resetField(`series.${index}.name`, {
                defaultValue: "Users count",
              });
            }, 0);
            setExpandedSeries([index]);
            if (!form.getFieldState("includePrevious")?.isTouched) {
              form.setValue("includePrevious", false);
            }
          }}
        >
          Add Series
        </Button>
      </FormControl>
      <FormControl>
        <FormLabel>Group by</FormLabel>
        <Select
          {...groupByField}
          onChange={(e) => {
            if (!form.getFieldState("includePrevious")?.isTouched) {
              form.setValue("includePrevious", false);
            }

            void groupByField.onChange(e);
          }}
          minWidth="fit-content"
        >
          <option value="">No grouping</option>
          {Object.entries(analyticsGroups).map(([groupParent, metrics]) => (
            <optgroup
              key={groupParent}
              label={camelCaseToTitleCase(groupParent)}
            >
              {Object.entries(metrics).map(
                ([groupKey, group]: [string, AnalyticsGroup]) => (
                  <option key={groupKey} value={`${groupParent}.${groupKey}`}>
                    {group.label}
                  </option>
                )
              )}
            </optgroup>
          ))}
        </Select>
      </FormControl>
      {(!graphType || !summaryGraphTypes.includes(graphType.value)) && (
        <FormControl>
          <Controller
            control={form.control}
            name="includePrevious"
            defaultValue={false}
            render={({ field: { onChange, value } }) => (
              <Switch
                onChange={onChange}
                isChecked={value}
                colorPalette="orange"
              >
                Include previous period
              </Switch>
            )}
          />
        </FormControl>
      )}
      <HStack width="full" gap={2}>
        <Spacer />

        {customId ? (
          <Button
            colorPalette="orange"
            onClick={updateGraph}
            isLoading={updateGraphById.isLoading}
            marginX={2}
            minWidth="fit-content"
          >
            Update
          </Button>
        ) : (
          <Button
            colorPalette="orange"
            isLoading={addNewGraph.isLoading}
            onClick={() => {
              addGraph();
            }}
            marginX={2}
            minWidth="fit-content"
          >
            Save
          </Button>
        )}
      </HStack>
    </VStack>
  );
}

function SeriesFieldItem({
  form,
  field,
  index,
  seriesFields,
  setExpandedSeries,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  field: FieldArrayWithId<CustomGraphFormData, "series", "id">;
  index: number;
  seriesFields: UseFieldArrayReturn<CustomGraphFormData, "series", "id">;
  setExpandedSeries: Dispatch<SetStateAction<number | number[]>>;
}) {
  const theme = useTheme();
  const colorSet = form.watch(`series.${index}.colorSet`);
  const coneColors = rotatingColors[colorSet].map((color, i) => {
    const [name, number] = color.color.split(".");
    const color_ = theme.colors[name ?? ""][+(number ?? "")];
    const len = rotatingColors[colorSet].length;

    return `${color_} ${(i / len) * 100}%, ${color_} ${((i + 1) / len) * 100}%`;
  });

  const seriesLength = form.watch(`series`).length;
  const groupBy = form.watch("groupBy");

  useEffect(() => {
    if (seriesLength === 1 && groupBy) {
      form.setValue(
        `series.${index}.colorSet`,
        groupBy.startsWith("sentiment") ||
          groupBy.startsWith("evaluations") ||
          groupBy.includes("has_error")
          ? "positiveNegativeNeutral"
          : "colors"
      );
    }
  }, [form, groupBy, index, seriesLength]);

  return (
    <AccordionItem
      key={field.id}
      border="1px solid"
      borderColor="gray.200"
      marginBottom={4}
    >
      <AccordionButton
        as={Box}
        cursor="pointer"
        role="button"
        background="gray.100"
        fontWeight="bold"
        paddingLeft={1}
      >
        <HStack width="full" gap={4}>
          <HStack width="full" gap={1}>
            <Menu>
              <MenuButton
                as={Button}
                variant="unstyled"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <Center>
                  <Box
                    width="32px"
                    height="32px"
                    borderRadius="100%"
                    background={`conic-gradient(from -${
                      360 / coneColors.length
                    }deg, ${coneColors.join(", ")})`}
                  ></Box>
                </Center>
              </MenuButton>
              <MenuList>
                {Object.entries(rotatingColors).map(([key, colorSet]) => (
                  <MenuItem
                    key={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      form.setValue(
                        `series.${index}.colorSet`,
                        key as RotatingColorSet,
                        { shouldTouch: true }
                      );
                    }}
                  >
                    <VStack align="start" gap={2}>
                      <Text>{camelCaseToTitleCase(key)}</Text>
                      <HStack gap={0} paddingLeft="12px">
                        {colorSet.map((color, i) => {
                          return (
                            <Box
                              key={i}
                              width="32px"
                              height="32px"
                              borderRadius="100%"
                              backgroundColor={color.color}
                              marginLeft="-12px"
                            ></Box>
                          );
                        })}
                      </HStack>
                    </VStack>
                  </MenuItem>
                ))}
              </MenuList>
            </Menu>
            <Input
              {...form.control.register(`series.${index}.name`)}
              border="none"
              paddingX={2}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onDoubleClick={() => {
                setExpandedSeries((prev) => {
                  if (Array.isArray(prev)) {
                    return prev.includes(index)
                      ? prev.filter((i) => i !== index)
                      : [...prev, index];
                  }
                  return prev;
                });
              }}
            />
          </HStack>
          {seriesFields.fields.length > 1 && (
            <Trash
              role="button"
              onClick={() => seriesFields.remove(index)}
              width={16}
            />
          )}
          <AccordionIcon />
        </HStack>
      </AccordionButton>
      <AccordionPanel>
        <SeriesField form={form} index={index} />
      </AccordionPanel>
    </AccordionItem>
  );
}

function SeriesField({
  form,
  index,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  index: number;
}) {
  const name = form.watch(`series.${index}.name`);
  const metric = form.watch(`series.${index}.metric`);
  const aggregation = form.watch(`series.${index}.aggregation`);
  const key = form.watch(`series.${index}.key`);
  const pipelineField = form.watch(`series.${index}.pipeline.field`);
  const pipelineAggregation = form.watch(
    `series.${index}.pipeline.aggregation`
  );

  const metricField = form.control.register(`series.${index}.metric`);
  const metric_ = metric ? getMetric(metric) : undefined;

  useEffect(() => {
    const aggregation_ = aggregation
      ? metricAggregations[aggregation] ?? aggregation
      : undefined;
    const pipeline_ = pipelineField
      ? analyticsPipelines[pipelineField]?.label ?? pipelineField
      : undefined;
    const pipelineAggregation_ =
      pipelineField && pipelineAggregation
        ? pipelineAggregations[pipelineAggregation] ?? pipelineAggregation
        : undefined;

    const name_ = uppercaseFirstLetterLowerCaseRest(
      [pipelineAggregation_, metric_?.label, aggregation_, pipeline_]
        .filter((x) => x)
        .join(" ")
    );

    if (!form.getFieldState(`series.${index}.name`)?.isTouched || !name) {
      form.resetField(`series.${index}.name`, { defaultValue: name_ });
    }
    if (!form.getFieldState(`series.${index}.colorSet`)?.isTouched && metric_) {
      form.setValue(`series.${index}.colorSet`, metric_.colorSet);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    aggregation,
    form,
    index,
    metric,
    metric_,
    metric_?.colorSet,
    metric_?.label,
    pipelineAggregation,
    pipelineField,
  ]);

  return (
    <VStack align="start" width="full" gap={4}>
      <FormControl>
        <FormLabel>Metric</FormLabel>
        <Grid width="full" gap={3} templateColumns="repeat(4, 1fr)">
          <Select
            {...metricField}
            gridColumn="span 2"
            onChange={(e) => {
              const metric_ = getMetric(e.target.value as any);
              if (!metric_.allowedAggregations.includes(aggregation)) {
                form.setValue(
                  `series.${index}.aggregation`,
                  metric_.allowedAggregations[0]!
                );
              }

              void metricField.onChange(e);
            }}
          >
            {Object.entries(analyticsMetrics).map(([group, metrics]) => (
              <optgroup key={group} label={camelCaseToTitleCase(group)}>
                {Object.entries(metrics).map(
                  ([metricKey, metric]: [string, AnalyticsMetric]) => (
                    <option key={metricKey} value={`${group}.${metricKey}`}>
                      {metric.label}
                    </option>
                  )
                )}
              </optgroup>
            ))}
          </Select>
          {metric_?.requiresKey && (
            <Box gridColumn="span 2">
              <Controller
                control={form.control}
                name={`series.${index}.key`}
                render={({ field }) => (
                  <FilterSelectField
                    field={field}
                    filter={metric_.requiresKey!.filter}
                    emptyOption={
                      metric_.requiresKey!.optional ? "all" : undefined
                    }
                  />
                )}
              />
            </Box>
          )}
          {metric_?.requiresSubkey && key && (
            <Box gridColumn="span 2">
              <Controller
                control={form.control}
                name={`series.${index}.subkey`}
                render={({ field }) => (
                  <FilterSelectField
                    field={field}
                    key_={key}
                    filter={metric_.requiresSubkey!.filter}
                  />
                )}
              />
            </Box>
          )}
          <Select
            gridColumn="span 1"
            {...form.control.register(`series.${index}.aggregation`)}
          >
            {getMetric(metric).allowedAggregations.map((agg) => (
              <option key={agg} value={agg}>
                {metricAggregations[agg]}
              </option>
            ))}
          </Select>
          <Select
            gridColumn="span 1"
            {...form.control.register(`series.${index}.pipeline.field`)}
          >
            <option value="">all</option>
            {Object.entries(analyticsPipelines)
              .filter(([key, _]) =>
                metric.includes("trace_id") ? key !== "trace_id" : true
              )
              .map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </Select>
        </Grid>
      </FormControl>
      {pipelineField && (
        <FormControl>
          <FormLabel>Aggregation</FormLabel>
          <Select
            {...form.control.register(`series.${index}.pipeline.aggregation`)}
            minWidth="fit-content"
          >
            {Object.entries(pipelineAggregations).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </FormControl>
      )}
    </VStack>
  );
}

function FilterSelectField<T extends FieldValues, U extends Path<T>>({
  field,
  key_,
  filter,
  emptyOption,
}: {
  field: ControllerRenderProps<T, U>;
  key_?: string;
  filter: FilterField;
  emptyOption?: string;
}) {
  const [query, setQuery] = useState("");

  const { filterParams, queryOpts } = useFilterParams();
  const filterData = api.analytics.dataForFilter.useQuery(
    {
      ...filterParams,
      field: filter,
      key: key_,
      query: query,
    },
    {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      keepPreviousData: true,
      enabled: queryOpts.enabled,
    }
  );

  const emptyOption_ = emptyOption ? [{ value: "", label: emptyOption }] : [];

  const options: { value: string; label: string }[] = emptyOption_.concat(
    filterData.data?.options.map(({ field, label }) => ({
      value: field,
      label,
    })) ?? []
  );

  const field_ = {
    ...field,
    onChange: (option: SingleValue<{ value: string; label: string }>) => {
      if (option) {
        field.onChange(option.value);
      }
    },
  };
  const current = options.find((option) => option.value === field.value);

  useEffect(() => {
    if (current === undefined && options.length > 0) {
      field.onChange(options[0]!.value);
    }
  }, [current, emptyOption, field, options]);

  return (
    <MultiSelect
      {...field_}
      menuPortalTarget={document.body}
      isLoading={filterData.isLoading}
      onInputChange={(input) => {
        setQuery(input);
      }}
      options={options as any}
      value={current}
      isSearchable={true}
      useBasicStyles
      components={{
        Option: ({ ...props }) => {
          let label = props.data.label;
          let details = "";
          // if label is like "[details] label" then split it
          const labelDetailsMatch = props.data.label.match(/^\[(.*)\] (.*)/);
          if (labelDetailsMatch) {
            label = labelDetailsMatch[2] ?? "";
            details = labelDetailsMatch[1] ?? "";
          }

          return (
            <chakraComponents.Option {...props}>
              <HStack align="end">
                <Box width="16px">
                  {props.isSelected && <Check width="16px" />}
                </Box>
                <VStack align="start" gap={"2px"}>
                  {details && (
                    <Text
                      fontSize="sm"
                      color={props.isSelected ? "white" : "gray.500"}
                    >
                      {details}
                    </Text>
                  )}
                  <Text>{label}</Text>
                </VStack>
              </HStack>
            </chakraComponents.Option>
          );
        },
      }}
    />
  );
}

function GraphTypeField({
  form,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
}) {
  return (
    <Controller
      control={form.control}
      name={`graphType`}
      render={({ field }) => (
        <MultiSelect
          {...field}
          options={chartOptions}
          placeholder="Select Graph Type"
          isSearchable={false}
          components={{
            Option: ({ children, ...props }) => (
              <chakraComponents.Option {...props}>
                <HStack gap={2}>
                  {props.data.icon}
                  <Text>{children}</Text>
                </HStack>
              </chakraComponents.Option>
            ),
            ValueContainer: ({ children, ...props }) => {
              const { getValue } = props;
              const value = getValue();
              const icon = value.length > 0 ? value[0]?.icon : null;

              return (
                <chakraComponents.ValueContainer {...props}>
                  <HStack gap={2}>
                    {icon}
                    {children}
                  </HStack>
                </chakraComponents.ValueContainer>
              );
            },
          }}
        />
      )}
    />
  );
}
