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
  Container,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Select,
  Spacer,
  Switch,
  Text,
  VStack
} from "@chakra-ui/react";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { useEffect, useState } from "react";
import { BarChart2, Trash, TrendingUp, Triangle } from "react-feather";
import {
  Controller,
  useFieldArray,
  useForm,
  type FieldArrayWithId,
  type UseFieldArrayReturn
} from "react-hook-form";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { FilterSelector } from "../../../components/FilterSelector";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../../components/PeriodSelector";
import {
  CustomGraph,
  type CustomGraphInput,
} from "../../../components/analytics/CustomGraph";
import {
  analyticsGroups,
  analyticsMetrics,
  analyticsPipelines,
  getMetric,
  metricAggregations,
  pipelineAggregations,
  type FlattenAnalyticsGroupsEnum,
  type FlattenAnalyticsMetricsEnum,
} from "../../../server/analytics/registry";
import type {
  AggregationTypes,
  AnalyticsGroup,
  AnalyticsMetric,
  PipelineAggregationTypes,
  PipelineFields,
} from "../../../server/analytics/types";
import {
  camelCaseToTitleCase,
  uppercaseFirstLetterLowerCaseRest,
} from "../../../utils/stringCasing";

export interface CustomGraphFormData {
  graphType: {
    label: string;
    value: CustomGraphInput["graphType"];
    icon: React.ReactNode;
  };
  series: {
    name: string;
    metric: FlattenAnalyticsMetricsEnum;
    aggregation: AggregationTypes;
    pipeline: {
      field: PipelineFields | "";
      aggregation: PipelineAggregationTypes;
    };
  }[];
  groupBy: FlattenAnalyticsGroupsEnum | "";
  includePrevious: boolean;
}

const chartOptions: CustomGraphFormData["graphType"][] = [
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
    label: "Bar Chart",
    value: "bar",
    icon: <BarChart2 />,
  },
];

const defaultValues: CustomGraphFormData = {
  graphType: chartOptions[0]!,
  series: [
    {
      name: "Messages count",
      metric: "volume.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "",
        aggregation: "avg",
      },
    },
  ],
  groupBy: "",
  includePrevious: true,
};

export default function AnalyticsCustomGraph() {
  const form = useForm<CustomGraphFormData>({
    defaultValues,
  });
  const seriesFields = useFieldArray({
    control: form.control,
    name: "series",
  });
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  const formData = form.watch();

  return (
    <DashboardLayout>
      <Container maxWidth="1600" padding={6}>
        <VStack width="full" align="start" spacing={6}>
          <HStack width="full" align="top">
            <Heading as={"h1"} size="lg" paddingTop={1}>
              Custom Graph
            </Heading>
            <Spacer />
            <FilterSelector />
            <PeriodSelector
              period={{ startDate, endDate }}
              setPeriod={setPeriod}
            />
          </HStack>
          <Card width="full">
            <CardBody>
              <HStack width="full" align="start" minHeight="500px" spacing={8}>
                <CustomGraphForm form={form} seriesFields={seriesFields} />
                <Box
                  border="1px solid"
                  borderColor="gray.200"
                  width="full"
                  paddingX={4}
                  paddingY={8}
                >
                  <CustomGraph
                    input={customGraphFormToCustomGraphInput(formData)}
                  />
                </Box>
              </HStack>
            </CardBody>
          </Card>
        </VStack>
      </Container>
    </DashboardLayout>
  );
}

const customGraphFormToCustomGraphInput = (
  formData: CustomGraphFormData
): CustomGraphInput => {
  return {
    graphId: "custom",
    graphType: formData.graphType.value,
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
        metric: series.metric,
        aggregation: series.aggregation,
      };
    }),
    groupBy: formData.groupBy || undefined,
    includePrevious: formData.includePrevious,
  };
};

function CustomGraphForm({
  form,
  seriesFields,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  seriesFields: UseFieldArrayReturn<CustomGraphFormData, "series", "id">;
}) {
  const [expandedSeries, setExpandedSeries] = useState<number | number[]>([0]);
  const groupByField = form.control.register("groupBy");

  return (
    <VStack width="full" align="start" spacing={4} maxWidth="500px">
      <FormControl>
        <FormLabel>Graph Type</FormLabel>
        <GraphTypeField form={form} />
      </FormControl>
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
            />
          ))}
        </Accordion>
        <Button
          onClick={() => {
            seriesFields.append({
              name: "Users count",
              metric: "volume.user_id",
              aggregation: "cardinality",
              pipeline: {
                field: "",
                aggregation: "avg",
              },
            });
            setExpandedSeries([seriesFields.fields.length]);
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
          onClick={(e) => {
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
      <FormControl>
        <Controller
          control={form.control}
          name="includePrevious"
          defaultValue={false}
          render={({ field: { onChange, value } }) => (
            <Switch onChange={onChange} isChecked={value}>
              Include previous period
            </Switch>
          )}
        />
      </FormControl>
    </VStack>
  );
}

function SeriesFieldItem({
  form,
  field,
  index,
  seriesFields,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  field: FieldArrayWithId<CustomGraphFormData, "series", "id">;
  index: number;
  seriesFields: UseFieldArrayReturn<CustomGraphFormData, "series", "id">;
}) {
  const name = form.watch(`series.${index}.name`);
  console.log("name", name);

  return (
    <AccordionItem
      key={field.id}
      border="1px solid"
      borderColor="gray.200"
      marginBottom={4}
    >
      <AccordionButton background="gray.100" fontWeight="bold">
        <HStack width="full">
          <Text>{name}</Text>
          <Spacer />
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
  const metric = form.watch(`series.${index}.metric`);
  const aggregation = form.watch(`series.${index}.aggregation`);
  const pipelineField = form.watch(`series.${index}.pipeline.field`);
  const pipelineAggregation = form.watch(
    `series.${index}.pipeline.aggregation`
  );

  const metricField = form.control.register(`series.${index}.metric`);

  useEffect(() => {
    const metric_ = metric ? getMetric(metric)?.label ?? metric : undefined;
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

    const name = uppercaseFirstLetterLowerCaseRest(
      [pipelineAggregation_, metric_, aggregation_, pipeline_]
        .filter((x) => x)
        .join(" ")
    );

    form.setValue(`series.${index}.name`, name);
  }, [aggregation, form, index, metric, pipelineAggregation, pipelineField]);

  return (
    <VStack align="start" width="full" spacing={4}>
      <FormControl>
        <FormLabel>Metric</FormLabel>
        <HStack width="full">
          <Select
            {...metricField}
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
          <Select
            {...form.control.register(`series.${index}.aggregation`)}
            minWidth="fit-content"
          >
            {getMetric(metric).allowedAggregations.map((agg) => (
              <option key={agg} value={agg}>
                {metricAggregations[agg]}
              </option>
            ))}
          </Select>
          <Select
            {...form.control.register(`series.${index}.pipeline.field`)}
            minWidth="fit-content"
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
        </HStack>
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
                <HStack spacing={2}>
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
                  <HStack spacing={2}>
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
