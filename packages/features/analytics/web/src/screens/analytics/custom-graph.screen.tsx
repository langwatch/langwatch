import {
  Accordion,
  Box,
  Button,
  Card,
  Center,
  Container,
  createListCollection,
  Field,
  Grid,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { chakraComponents, Select as MultiSelect, type SingleValue } from "chakra-react-select";
import React, { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  BarChart2,
  Bell,
  Check,
  ChevronDown,
  GitBranch,
  Info,
  MoreVertical,
  PieChart,
  Trash,
  TrendingUp,
  Triangle,
} from "react-feather";
import {
  Controller,
  type ControllerRenderProps,
  type FieldArrayWithId,
  type FieldValues,
  type Path,
  type UseFieldArrayReturn,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { LuChartArea, LuPlus } from "react-icons/lu";
import { useDebounceValue } from "usehooks-ts";
import { deriveSeriesIdentifier } from "@langwatch/automation-contract";
import { CodeSnippet } from "../../ui/elements/code-snippet";
import { Dialog } from "@langwatch/design-system/dialog";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Menu } from "@langwatch/design-system/menu";
import { Select } from "@langwatch/design-system/select";
import { Switch } from "@langwatch/design-system/switch";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useFilterParams } from "../../behavior/use-filter-params";
import {
  CustomGraph,
  type CustomGraphInput,
  summaryGraphTypes,
} from "../../ui/sections/custom-graph";
import { FilterIconWithBadge } from "../../ui/sections/filter-icon-with-badge";
import { FilterSidebar } from "../../ui/sections/filter-sidebar";
import { useFilterToggle } from "../../behavior/use-filter-toggle";
import { FilterToggle, FilterToggleButton } from "../../ui/sections/filter-toggle";
import { useAnalyticsPeriod } from "../../behavior/use-analytics-period";
import { AnalyticsPeriodPicker } from "../../ui/sections/analytics-period-picker";
import { SeriesFiltersDialog } from "../../ui/sections/series-filters-dialog";
import { getRawColorValue } from "@langwatch/design-system/color-mode";
import { useAnalyticsHost } from "../../model/analytics-host";
import {
  analyticsGroups,
  analyticsMetrics,
  analyticsPipelines,
  type FlattenAnalyticsGroupsEnum,
  type FlattenAnalyticsMetricsEnum,
  getGroup,
  getMetric,
  metricAggregations,
  pipelineAggregations,
} from "../../model/analytics-registry";
import type {
  AggregationTypes,
  PipelineAggregationTypes,
  PipelineFields,
  SharedFiltersInput,
} from "../../model/analytics-vocabulary";
import { filterOutEmptyFilters, type FilterParam } from "../../model/analytics-filter-params";
import type { FilterField } from "../../model/analytics-filter-definition";
import { analyticsApi, type AnalyticsFilterOption } from "../../behavior/analytics-api";
import { type RotatingColorSet, rotatingColors } from "@langwatch/design-system/rotating-colors";
import { camelCaseToTitleCase, uppercaseFirstLetterLowerCaseRest } from "../../model/string-casing";

/** Which of the builder's two addresses this render is. */
export type CustomGraphScreenMode = "new" | "edit";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

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
    filters?: Record<FilterField, FilterParam>;
    asPercent?: boolean;
  }[];
  groupBy?: FlattenAnalyticsGroupsEnum | "";
  groupByKey?: string;
  includePrevious: boolean;
  timeScale: "full" | number;
  connected?: boolean;
  alert?: {
    enabled: boolean;
    seriesName: string;
    threshold: number;
    operator: "gt" | "lt" | "gte" | "lte" | "eq";
    timePeriod: number;
    type: "CRITICAL" | "WARNING" | "INFO";
    action: "SEND_EMAIL" | "SEND_SLACK_MESSAGE";
    actionParams?: {
      members?: string[];
      slackWebhook?: string;
    };
    triggerId?: string;
  };
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
    filters?: Record<FilterField, FilterParam>;
  }[];
  groupBy?: FlattenAnalyticsGroupsEnum;
  groupByKey?: string;
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
  {
    label: "Monitor Graph",
    value: "monitor_graph",
    icon: <LuChartArea />,
  },
];

const defaultValues: CustomGraphFormData = {
  title: "Traces count",
  graphType: chartOptions[1]!,
  series: [
    {
      name: "Traces count",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "",
        aggregation: "avg",
      },
      filters: {} as Record<FilterField, FilterParam>,
      asPercent: false,
    },
  ],
  groupBy: undefined,
  timeScale: ONE_DAY,
  includePrevious: true,
};

function AnalyticsCustomGraphContent({
  customId,
  graph,
  name,
  filters,
  alert,
}: {
  customId?: string;
  graph?: CustomGraphInput;
  name?: string;
  filters?: Record<FilterField, string[] | Record<string, string[]>>;
  alert?: CustomGraphFormData["alert"];
}) {
  const jsonModal = useDisclosure();
  const apiModal = useDisclosure();
  const { filterParams, setFilters } = useFilterParams();

  let initialFormData: CustomGraphFormData | undefined;
  if (customId && graph) {
    initialFormData = customGraphInputToFormData(graph);
    if (alert) {
      initialFormData.alert = alert;
    }
  }

  const form = useForm<CustomGraphFormData>({
    defaultValues: customId ? initialFormData : defaultValues,
  });

  const hasSetFilters = useRef(false);

  useEffect(() => {
    if (customId && filters && !hasSetFilters.current) {
      setFilters(filters);
      hasSetFilters.current = true;
    }
  }, [customId, filters, setFilters]);

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
    mode,
    setPeriod,
    setRelativePeriod,
  } = useAnalyticsPeriod();
  const { showFilters } = useFilterToggle();

  const formData = JSON.stringify(form.watch() ?? {});
  const [debouncedCustomGraphInput, setDebouncedCustomGraphInput] = useDebounceValue<
    CustomGraphInput | undefined
  >(undefined, 400);
  const [debouncedCustomAPIInput, setDebouncedCustomAPIInput] = useDebounceValue<
    CustomAPICallData | undefined
  >(undefined, 400);

  useEffect(() => {
    const parsedFormData = JSON.parse(formData) as CustomGraphFormData;

    const customGraphInput = customGraphFormToCustomGraphInput(parsedFormData);
    const apiJson = customAPIinput(parsedFormData, filterParams);
    if (typeof apiJson?.timeScale === "string" && apiJson.timeScale !== "full") {
      apiJson.timeScale = parseInt(apiJson.timeScale);
    }
    setDebouncedCustomAPIInput(apiJson);
    setDebouncedCustomGraphInput(customGraphInput);
  }, [formData, filterParams, setDebouncedCustomAPIInput, setDebouncedCustomGraphInput]);

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Custom Graph</PageLayout.Heading>
        <Spacer />
        <FilterToggle />
        <AnalyticsPeriodPicker
          period={{ startDate, endDate }}
          mode={mode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
        />
      </PageLayout.Header>
      <Container maxWidth="1600" padding={6}>
        <VStack width="full" align="start" gap={6}>
          <HStack width="full" align="start" gap={8}>
            <CustomGraphForm
              form={form}
              seriesFields={seriesFields}
              customId={customId}
              filterParams={filterParams}
            />
            <Card.Root width="full">
              <Card.Header paddingTop={3} paddingBottom={1} paddingX={3}>
                <HStack width="full" justify="space-between">
                  <Input
                    {...form.control.register(`title`)}
                    border="none"
                    paddingX={2}
                    fontWeight="bold"
                    fontSize="16px"
                  />
                  <HStack gap={2}>
                    {/*
                     * THE ALERT ENTRY POINTS DID NOT TRAVEL, and this is where
                     * the other two of the automations family's seven platform
                     * breaks stop being breaks.
                     *
                     * Both — the bell that edits an existing alert and the
                     * "Add alert" button that authors one — called
                     * `openDrawer("automation", …)`, and that registry entry was
                     * DELETED when the automations family moved. Authoring an
                     * alert is `@langwatch/automation-web`'s drawer, a web
                     * package may not import another web package, and the chrome
                     * layout route that would mount a registry for a packaged
                     * screen is separate work. Every alert already authored
                     * still fires and the automations pages still edit them;
                     * what is gone is the shortcut from a chart to its alert.
                     * RECORDED as one of the first customers of a cross-feature
                     * overlay capability.
                     */}
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <Button variant="ghost" paddingX={0}>
                          <MoreVertical />
                        </Button>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item value="api" onClick={apiModal.onOpen}>
                          Show API
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                  </HStack>
                </HStack>
              </Card.Header>
              <Card.Body>
                {debouncedCustomGraphInput && (
                  <CustomGraph
                    input={debouncedCustomGraphInput}
                    filters={
                      filterParams.filters as
                        | Record<FilterField, string[] | Record<string, string[]>>
                        | undefined
                    }
                  />
                )}
              </Card.Body>
            </Card.Root>
            {showFilters && <FilterSidebar hideTopics={true} />}
          </HStack>
        </VStack>
      </Container>
      <Dialog.Root
        open={jsonModal.open}
        onOpenChange={({ open }) => jsonModal.setOpen(open)}
        size="lg"
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>Graph JSON</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <Textarea rows={16}>{JSON.stringify(debouncedCustomGraphInput, null, 2)}</Textarea>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={apiModal.open}
        onOpenChange={({ open }) => apiModal.setOpen(open)}
        size="lg"
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>JSON API</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <Text paddingBottom={8}>
              Incorporate the following JSON payload within the body of your HTTP POST request to
              access identical data tailored for the custom graphs.
            </Text>
            <Box padding={4} backgroundColor="bg.subtle">
              <CodeSnippet
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
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

export const customGraphInputToFormData = (graphInput: CustomGraphInput): CustomGraphFormData => {
  return {
    title: graphInput.graphId === "custom" ? undefined : graphInput.graphId,
    graphType: chartOptions.find((option) => option.value === graphInput.graphType)!,
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
      filters: filterOutEmptyFilters(series.filters),
      asPercent: series.asPercent,
    })),
    groupBy: graphInput.groupBy ?? "",
    groupByKey: graphInput.groupByKey,
    includePrevious: graphInput.includePrevious ?? true,
    timeScale: graphInput.timeScale ?? 1,
    connected: graphInput.connected,
  };
};

export const customGraphFormToCustomGraphInput = (
  formData: CustomGraphFormData,
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
    graphType: formData.graphType?.value ?? "line",
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
        filters: series.filters,
        asPercent: series.asPercent,
      };
    }),
    groupBy: formData.groupBy === "" ? undefined : formData.groupBy,
    groupByKey: formData.groupByKey,
    includePrevious: formData.includePrevious,
    timeScale: formData.timeScale,
    connected: formData.connected,
    height: 517,
  };
};

const customAPIinput = (
  formData: CustomGraphFormData,
  filterParams: SharedFiltersInput,
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
        filters: series.filters,
        asPercent: series.asPercent,
      };
    }) as CustomAPICallData["series"],
    groupBy: formData.groupBy === "" ? undefined : formData.groupBy,
    groupByKey: formData.groupByKey,
    timeScale: formData.timeScale,
  };
};

function CustomGraphForm({
  form,
  seriesFields,
  customId,
  filterParams,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  seriesFields: UseFieldArrayReturn<CustomGraphFormData, "series", "id">;
  customId?: string;
  filterParams: SharedFiltersInput;
}) {
  const [expandedSeries, setExpandedSeries] = useState<string[]>(["0"]);
  const groupByField = form.control.register("groupBy");
  const graphType = useWatch({ control: form.control, name: "graphType" });
  const groupBy = useWatch({ control: form.control, name: "groupBy" });
  const title = useWatch({ control: form.control, name: "title" });
  const series = useWatch({ control: form.control, name: "series" });
  const { showFilters, setShowFilters } = useFilterToggle();

  const joinedSeriesNames = series.map((s) => s.name).join(", ");

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

  const addNewGraph = analyticsApi.graphs.create.useMutation();
  const updateGraphById = analyticsApi.graphs.updateById.useMutation();
  const host = useAnalyticsHost();
  const project = host.project();
  const trpc = analyticsApi.useUtils();
  // Which dashboard the address says this chart belongs to.
  const dashboardId = host.route().query.dashboard;

  const addGraph = () => {
    const graphName = form.getValues("title");
    const graphJson = customGraphFormToCustomGraphInput(form.getValues());
    if (graphJson?.hasOwnProperty("height")) {
      graphJson.height = 300;
    }

    // Alert-writing moved to the automations drawer (ADR-034 Phase 5.2 —
    // the chart-card `Add alert` bell opens `automation` drawer with
    // `prefilledGraphId`). This graph mutation is graph-shape only.

    addNewGraph.mutate(
      {
        projectId: project?.id ?? "",
        name: graphName ?? "",
        graph: JSON.stringify(graphJson),
        filterParams: filterParams,
        dashboardId: dashboardId,
      },
      {
        onSuccess: () => {
          void trpc.graphs.getById.invalidate();
          // Navigate back to the same page we came from
          const dashboardUrl = dashboardId
            ? `/${project?.slug}/analytics/reports?dashboard=${dashboardId}`
            : `/${project?.slug}/analytics/reports`;
          host.navigate(dashboardUrl);
        },
      },
    );
  };

  const updateGraph = () => {
    const graphName = form.getValues("title");
    const graphJson = customGraphFormToCustomGraphInput(form.getValues());

    // Alert-writing moved to the automations drawer (ADR-034 Phase 5.2).
    // This graph mutation is graph-shape only; edits to the alert go
    // through the bell icon → automation drawer edit path.

    updateGraphById.mutate(
      {
        projectId: project?.id ?? "",
        name: graphName ?? "",
        graphId: customId ?? "",
        graph: JSON.stringify(graphJson),
        filterParams: filterParams,
      },
      {
        onSuccess: () => {
          void trpc.graphs.getById.invalidate();
          // Navigate back to the same dashboard we came from
          const dashboardUrl = dashboardId
            ? `/${project?.slug}/analytics/reports?dashboard=${dashboardId}`
            : `/${project?.slug}/analytics/reports`;
          host.navigate(dashboardUrl);
        },
      },
    );
  };

  return (
    <VStack width="full" align="start" gap={4} maxWidth="500px">
      <Field.Root>
        <Field.Label>Graph Type</Field.Label>
        <GraphTypeField form={form} />
      </Field.Root>
      {(!graphType || !summaryGraphTypes.includes(graphType.value)) && (
        <Field.Root>
          <Tooltip
            content="If minutes are chosen when the duration is long, it will automatically adjust to the appropriate time scale."
            portalled
          >
            <Field.Label>
              Time Scale
              <Info size={16} />
            </Field.Label>
          </Tooltip>

          <Controller
            control={form.control}
            name="timeScale"
            render={({ field }) => (
              <NativeSelect.Root>
                <NativeSelect.Field {...field}>
                  <option value="full">Full Period</option>
                  <option value="10">10 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="1440">Daily</option>
                  <option value="10080">7 days</option>
                  <option value="43200">30 days</option>
                  <option value="129600">90 days</option>
                  <option value="525600">365 days</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            )}
          />
        </Field.Root>
      )}
      {graphType?.value === "scatter" && (
        <Field.Root>
          <Controller
            control={form.control}
            name="connected"
            defaultValue={false}
            render={({ field: { onChange, value } }) => (
              <Switch onCheckedChange={({ checked }) => onChange(checked)} checked={value}>
                Connect dots
              </Switch>
            )}
          />
        </Field.Root>
      )}
      <Field.Root>
        <Field.Label fontSize="16px" width="full">
          <HStack width="full" justify="space-between">
            Series
            <Button
              size="xs"
              variant="outline"
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
                  { shouldFocus: false },
                );
                setTimeout(() => {
                  form.resetField(`series.${index}.name`, {
                    defaultValue: "Users count",
                  });
                }, 0);
                setTimeout(() => {
                  setExpandedSeries([index.toString()]);
                }, 100);
                if (!form.getFieldState("includePrevious")?.isTouched) {
                  form.setValue("includePrevious", false);
                }
              }}
            >
              <LuPlus />
              Add Series
            </Button>
          </HStack>
        </Field.Label>
        <Accordion.Root
          width="full"
          multiple
          value={expandedSeries}
          onValueChange={(change) => setExpandedSeries(change.value)}
        >
          {seriesFields.fields.map((field, index) => (
            <SeriesFieldItem
              key={field.id}
              form={form}
              field={field}
              index={index}
              seriesFields={seriesFields}
              setExpandedSeries={setExpandedSeries}
              customId={customId}
            />
          ))}
        </Accordion.Root>
      </Field.Root>
      <Field.Root>
        <Field.Label>Group by</Field.Label>
        <Grid
          width="full"
          gap={3}
          templateColumns={groupBy && getGroup(groupBy).requiresKey ? "repeat(2, 1fr)" : "1fr"}
        >
          <NativeSelect.Root>
            <NativeSelect.Field
              {...groupByField}
              onChange={(e) => {
                // Clear groupByKey when groupBy changes
                form.setValue("groupByKey", undefined);
                void groupByField.onChange(e);
              }}
            >
              <option value="">No grouping</option>
              {Object.entries(analyticsGroups).map(([groupParent, metrics]) => (
                <optgroup key={groupParent} label={camelCaseToTitleCase(groupParent)}>
                  {Object.entries(metrics).map(([groupKey, group]) => (
                    <option key={groupKey} value={`${groupParent}.${groupKey}`}>
                      {group.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          {groupBy && getGroup(groupBy).requiresKey && (
            <Controller
              control={form.control}
              name="groupByKey"
              render={({ field }) => (
                <FilterSelectField
                  field={field}
                  filter={getGroup(groupBy).requiresKey!.filter}
                  emptyOption={getGroup(groupBy).requiresKey!.optional ? "all" : undefined}
                  currentSelected={field.value}
                />
              )}
            />
          )}
        </Grid>
      </Field.Root>
      {(!graphType || !summaryGraphTypes.includes(graphType.value)) && (
        <Field.Root>
          <Controller
            control={form.control}
            name="includePrevious"
            defaultValue={false}
            render={({ field: { onChange, value } }) => (
              <Switch
                onCheckedChange={({ checked }) => onChange(checked)}
                checked={value}
                colorPalette="orange"
              >
                Include previous period
              </Switch>
            )}
          />
        </Field.Root>
      )}
      <HStack width="full" gap={2} paddingTop={4}>
        <Button
          variant="outline"
          colorPalette="orange"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
        >
          <FilterIconWithBadge />
          Add Graph Filter
        </Button>
        <Spacer />
        <Button
          variant="outline"
          onClick={() => {
            const dashboardUrl = dashboardId
              ? `/${project?.slug}/analytics/reports?dashboard=${dashboardId}`
              : `/${project?.slug}/analytics/reports`;
            host.navigate(dashboardUrl);
          }}
        >
          Cancel
        </Button>
        {customId ? (
          <Button
            colorPalette="orange"
            onClick={updateGraph}
            loading={updateGraphById.isPending}
            marginX={2}
            minWidth="fit-content"
          >
            Update
          </Button>
        ) : (
          <Button
            colorPalette="orange"
            loading={addNewGraph.isPending}
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
  customId,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  field: FieldArrayWithId<CustomGraphFormData, "series", "id">;
  index: number;
  seriesFields: UseFieldArrayReturn<CustomGraphFormData, "series", "id">;
  setExpandedSeries: Dispatch<SetStateAction<string[]>>;
  customId?: string;
}) {
  const colorSet = useWatch({
    control: form.control,
    name: `series.${index}.colorSet`,
  });
  const coneColors = rotatingColors[colorSet].map((color, i) => {
    const color_ = getRawColorValue(color.color);
    const len = rotatingColors[colorSet].length;

    return `${color_} ${(i / len) * 100}%, ${color_} ${((i + 1) / len) * 100}%`;
  });

  const seriesValues = useWatch({ control: form.control, name: "series" });
  const seriesLength = seriesValues.length;
  const groupBy = useWatch({ control: form.control, name: "groupBy" });

  // Track the previous groupBy to only auto-set colors when user actually changes it
  const prevGroupByRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Only auto-set colors when groupBy actually changes (not on initial load)
    const prevGroupBy = prevGroupByRef.current;
    prevGroupByRef.current = groupBy;

    // Skip if this is the initial value being set (prevGroupBy was undefined)
    if (prevGroupBy === undefined) {
      return;
    }

    // Skip if groupBy didn't actually change
    if (prevGroupBy === groupBy) {
      return;
    }

    if (seriesLength === 1 && groupBy) {
      form.setValue(
        `series.${index}.colorSet`,
        groupBy.startsWith("sentiment") ||
          groupBy === "evaluations.evaluation_passed" ||
          groupBy === "evaluations.evaluation_processing_state" ||
          groupBy.includes("has_error")
          ? "positiveNegativeNeutral"
          : "colors",
      );
    }
  }, [form, groupBy, index, seriesLength]);

  return (
    <Accordion.Item
      key={field.id}
      value={index.toString()}
      border="1px solid"
      borderColor="border"
      marginBottom={4}
    >
      <Accordion.ItemTrigger
        cursor="pointer"
        role="button"
        background="bg.subtle"
        fontWeight="bold"
        paddingLeft={1}
        paddingRight={3}
      >
        <HStack width="full" gap={4}>
          <HStack width="full" gap={1}>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="plain" padding={0} onClick={(e) => e.stopPropagation()}>
                  <Center>
                    <Box
                      width="32px"
                      height="32px"
                      borderRadius="100%"
                      background={`conic-gradient(from -${
                        360 / coneColors.length
                      }deg, ${coneColors.join(", ")})`}
                    />
                  </Center>
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                {Object.entries(rotatingColors).map(([key, colorSet]) => (
                  <Menu.Item
                    key={key}
                    value={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      form.setValue(`series.${index}.colorSet`, key as RotatingColorSet, {
                        shouldTouch: true,
                      });
                    }}
                  >
                    <VStack align="start" gap={2}>
                      <Text>{camelCaseToTitleCase(key)}</Text>
                      <HStack gap={0} paddingLeft="12px">
                        {colorSet.map((color, i) => (
                          <Box
                            key={i}
                            width="32px"
                            height="32px"
                            borderRadius="100%"
                            backgroundColor={color.color}
                            marginLeft="-12px"
                          />
                        ))}
                      </HStack>
                    </VStack>
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Root>
            <Input
              {...form.control.register(`series.${index}.name`)}
              border="none"
              paddingX={2}
              onClick={(e) => {
                e.stopPropagation();
              }}
              fontSize="14px"
              fontWeight="normal"
              onDoubleClick={() => {
                setExpandedSeries((prev) => {
                  if (Array.isArray(prev)) {
                    return prev.includes(index.toString())
                      ? prev.filter((i) => i.toString() !== index.toString())
                      : [...prev, index.toString()];
                  }
                  return prev;
                });
              }}
              background="none"
            />
          </HStack>
          <HStack gap={0}>
            {seriesFields.fields.length > 1 && (
              <Button
                variant="plain"
                padding={0}
                onClick={(e) => {
                  e.stopPropagation();
                  seriesFields.remove(index);
                }}
              >
                <Trash width={16} />
              </Button>
            )}
            <Accordion.ItemIndicator>
              <ChevronDown />
            </Accordion.ItemIndicator>
          </HStack>
        </HStack>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <Box padding={3}>
          <SeriesField form={form} index={index} customId={customId} />
        </Box>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}

function SeriesField({
  form,
  index,
  customId,
}: {
  form: ReturnType<typeof useForm<CustomGraphFormData>>;
  index: number;
  customId?: string;
}) {
  const name = useWatch({
    control: form.control,
    name: `series.${index}.name`,
  });
  const metric = useWatch({
    control: form.control,
    name: `series.${index}.metric`,
  });
  const aggregation = useWatch({
    control: form.control,
    name: `series.${index}.aggregation`,
  });
  const key = useWatch({ control: form.control, name: `series.${index}.key` });
  const pipelineField = useWatch({
    control: form.control,
    name: `series.${index}.pipeline.field`,
  });
  const pipelineAggregation = useWatch({
    control: form.control,
    name: `series.${index}.pipeline.aggregation`,
  });
  const filters = useWatch({
    control: form.control,
    name: `series.${index}.filters`,
  });
  const nonEmptyFilters = filterOutEmptyFilters(filters);

  const metric_ = metric ? getMetric(metric) : undefined;

  /**
   * The series filter editor, mounted here rather than opened from a registry.
   *
   * `platform/app` registered it as the `seriesFilters` drawer and handed it an
   * `onChange` through `setFlowCallbacks` — a registry-wide side channel that
   * exists only because an address can carry strings and not functions. Mounted
   * inline, `onChange` is a prop, and the registry entry is deleted with the
   * drawer.
   */
  const [editingSeriesFilters, setEditingSeriesFilters] = useState(false);

  // Sync aggregation when metric changes — if the current aggregation
  // isn't allowed by the new metric, switch to the first allowed one.
  useEffect(() => {
    if (metric_ && !metric_.allowedAggregations.includes(aggregation)) {
      const firstAllowed = metric_.allowedAggregations[0] ?? "avg";
      form.setValue(`series.${index}.aggregation`, firstAllowed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  useEffect(() => {
    const aggregation_ = aggregation ? (metricAggregations[aggregation] ?? aggregation) : undefined;
    const pipeline_ = pipelineField
      ? (analyticsPipelines[pipelineField]?.label ?? pipelineField)
      : undefined;
    const pipelineAggregation_ =
      pipelineField && pipelineAggregation
        ? (pipelineAggregations[pipelineAggregation] ?? pipelineAggregation)
        : undefined;

    const name_ = uppercaseFirstLetterLowerCaseRest(
      [pipelineAggregation_, metric_?.label, aggregation_, pipeline_].filter((x) => x).join(" "),
    );

    if ((!customId && !form.getFieldState(`series.${index}.name`)?.isTouched) || !name) {
      form.resetField(`series.${index}.name`, { defaultValue: name_ });
    }
    // Skip automatic color set logic when editing an existing graph
    if (!customId && !form.getFieldState(`series.${index}.colorSet`)?.isTouched && metric_) {
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
      <Field.Root>
        <Field.Label>Metric</Field.Label>
        <Grid width="full" gap={3} templateColumns="repeat(4, 1fr)">
          <Controller
            control={form.control}
            name={`series.${index}.metric`}
            render={({ field: metricField }) => (
              <NativeSelect.Root gridColumn="span 2">
                <NativeSelect.Field
                  value={metricField.value ?? ""}
                  onChange={(e) => {
                    metricField.onChange(e.target.value as FlattenAnalyticsMetricsEnum);
                  }}
                >
                  {Object.entries(analyticsMetrics).map(([group, metrics]) => (
                    <optgroup key={group} label={camelCaseToTitleCase(group)}>
                      {Object.entries(metrics).map(([metricKey, m]) => (
                        <option key={metricKey} value={`${group}.${metricKey}`}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            )}
          />
          {metric_?.requiresKey && (
            <Box gridColumn="span 2">
              <Controller
                control={form.control}
                name={`series.${index}.key`}
                render={({ field }) => (
                  <FilterSelectField
                    field={field}
                    filter={metric_.requiresKey!.filter}
                    emptyOption={metric_.requiresKey!.optional ? "all" : undefined}
                    currentSelected={field.value}
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
                    currentSelected={field.value}
                  />
                )}
              />
            </Box>
          )}
          <NativeSelect.Root gridColumn="span 1">
            <NativeSelect.Field
              value={aggregation}
              onChange={(e) => {
                form.setValue(`series.${index}.aggregation`, e.target.value as AggregationTypes);
              }}
            >
              {metric_?.allowedAggregations.map((agg) => (
                <option key={agg} value={agg}>
                  {metricAggregations[agg]}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <NativeSelect.Root gridColumn="span 1">
            <NativeSelect.Field {...form.control.register(`series.${index}.pipeline.field`)}>
              <option value="">all</option>
              {Object.entries(analyticsPipelines)
                .filter(([key]) => (metric.includes("trace_id") ? key !== "trace_id" : true))
                .map(([key, { label }]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Grid>
      </Field.Root>
      {pipelineField && (
        <Field.Root>
          <Field.Label>Aggregation</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field {...form.control.register(`series.${index}.pipeline.aggregation`)}>
              {Object.entries(pipelineAggregations).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>
      )}
      <HStack gap={4}>
        <Field.Root flexShrink={1} maxWidth="fit-content">
          <Controller
            control={form.control}
            name={`series.${index}.filters`}
            render={({ field }) => {
              return (
                <>
                  <FilterToggleButton
                    toggled={false}
                    filters={field.value ?? ({} as Record<FilterField, FilterParam>)}
                    onClick={() => setEditingSeriesFilters(true)}
                  >
                    {Object.keys(nonEmptyFilters).length > 0
                      ? "Edit Filters"
                      : "Add Filter for Series"}
                  </FilterToggleButton>
                  <SeriesFiltersDialog
                    open={editingSeriesFilters}
                    onOpenChange={setEditingSeriesFilters}
                    filters={field.value ?? ({} as Record<FilterField, FilterParam>)}
                    onChange={({ filters: next }) => form.setValue(`series.${index}.filters`, next)}
                  />
                </>
              );
            }}
          />
        </Field.Root>
        {Object.keys(nonEmptyFilters).length > 0 && (
          <Field.Root display="flex" flexDirection="row" alignItems="center" gap={2}>
            <Controller
              control={form.control}
              name={`series.${index}.asPercent`}
              render={({ field }) => (
                <>
                  <Switch
                    {...field}
                    checked={!!field.value}
                    value="on"
                    onCheckedChange={({ checked }) => field.onChange(checked)}
                  />
                  <Field.Label flexShrink={0}>Show in percentage (%)</Field.Label>
                </>
              )}
            />
          </Field.Root>
        )}
      </HStack>
    </VStack>
  );
}

function FilterSelectField<T extends FieldValues, U extends Path<T>>({
  field,
  key_,
  filter,
  emptyOption,
  currentSelected,
}: {
  field: ControllerRenderProps<T, U>;
  key_?: string;
  filter: FilterField;
  emptyOption?: string;
  currentSelected?: string;
}) {
  const [query, setQuery] = useState("");

  const { filterParams, queryOpts } = useFilterParams();
  const filterData = analyticsApi.analytics.dataForFilter.useQuery(
    {
      ...filterParams,
      field: filter,
      key: key_,
      query: query,
    },
    {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      // Keeps the previous answer on screen while the next one loads. The
      // React Query sentinel would mean importing the query library, which a
      // governed screen may not; the identity function is what that sentinel
      // does.
      placeholderData: (previous?: { options: AnalyticsFilterOption[] }) => previous,
      enabled: queryOpts.enabled,
    },
  );

  const emptyOption_ = emptyOption ? [{ value: "", label: emptyOption }] : [];

  const options: { value: string; label: string }[] = emptyOption_.concat(
    filterData.data?.options.map(({ field, label }) => ({
      value: field,
      label,
    })) ?? [],
  );

  if (currentSelected && !options.find((option) => option.value === currentSelected)) {
    options.push({ value: currentSelected, label: currentSelected });
  }

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
      // useBasicStyles
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
                <Box width="16px">{props.isSelected && <Check width="16px" />}</Box>
                <VStack align="start" gap={"2px"}>
                  {details && (
                    <Text fontSize="sm" color={props.isSelected ? "fg" : "fg.muted"}>
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

function GraphTypeField({ form }: { form: ReturnType<typeof useForm<CustomGraphFormData>> }) {
  const graphTypeCollection = createListCollection({
    items: chartOptions.map((option) => ({
      label: option.label,
      value: option.value,
      icon: option.icon,
    })),
  });

  return (
    <Controller
      control={form.control}
      name="graphType"
      render={({ field }) => (
        <Select.Root
          collection={graphTypeCollection}
          value={field.value ? [field.value.value] : []}
          onValueChange={(change) => {
            const selectedOption = chartOptions.find((opt) => opt.value === change.value[0]);
            field.onChange(selectedOption);
          }}
        >
          <Select.Trigger>
            <Select.ValueText>
              {() =>
                field.value ? (
                  <HStack gap={2}>
                    {field.value.icon}
                    <Text>{field.value.label}</Text>
                  </HStack>
                ) : (
                  <Text>Select graph type</Text>
                )
              }
            </Select.ValueText>
          </Select.Trigger>
          <Select.Content>
            {graphTypeCollection.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                <HStack gap={2}>
                  {item.icon}
                  <Text>{item.label}</Text>
                </HStack>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}
    />
  );
}

/**
 * The chart builder, at both of its addresses.
 *
 * ONE SCREEN, TWO KEYS, AND THE MODE ARRIVES AS A PROP. `platform/app` had
 * `analytics/custom/index.tsx` (a new chart) and `analytics/custom/[id].tsx` (an
 * existing one), the second of which rendered the first with the stored graph
 * loaded. The route table gives each address its own page key, so `apps/ui`
 * maps a key to a mode and the builder is TOLD which it is rather than reading
 * the address back — the automations family's tab-as-prop shape, applied to a
 * form. The graph `:id` itself is a route PARAMETER, which the router captured.
 *
 * The loading and not-found states are the edit mode's own, unchanged: a graph
 * whose read refuses says so instead of opening a blank builder that would
 * save a second chart on submit.
 */
export default function CustomGraphScreen({ mode }: { mode: CustomGraphScreenMode }) {
  const host = useAnalyticsHost();
  const graphId = host.route().params.id;
  const projectId = host.project()?.id ?? "";

  const stored = analyticsApi.graphs.getById.useQuery(
    { projectId, id: graphId ?? "" },
    { enabled: mode === "edit" && !!projectId && !!graphId, retry: false },
  );

  if (mode === "new") {
    return <AnalyticsCustomGraphContent />;
  }

  if (stored.error) {
    return (
      <VStack align="start" padding={8} gap={2}>
        <Text fontSize="xl" fontWeight="bold">
          Graph not found
        </Text>
        <Text color="fg.muted">
          The graph you are looking for does not exist or you do not have access to it.
        </Text>
      </VStack>
    );
  }

  if (stored.isLoading) {
    return <Box padding={8}>Loading…</Box>;
  }

  const graph = stored.data?.graph;
  if (!graph) return null;

  const rawAlert = stored.data?.alert;
  const alert: CustomGraphFormData["alert"] | undefined =
    rawAlert != null && rawAlert.type != null
      ? (rawAlert as unknown as CustomGraphFormData["alert"])
      : void 0;

  return (
    <AnalyticsCustomGraphContent
      customId={graphId ?? ""}
      graph={graph as unknown as CustomGraphInput}
      name={stored.data?.name ?? ""}
      {...(stored.data?.filters
        ? {
            filters: stored.data.filters as Record<
              FilterField,
              string[] | Record<string, string[]>
            >,
          }
        : {})}
      {...(alert ? { alert } : {})}
    />
  );
}
