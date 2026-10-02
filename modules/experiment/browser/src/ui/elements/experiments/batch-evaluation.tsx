import type { UiHostProject } from "@langwatch/browser-host/use-organization-team-project";
import { downloadCsv } from "@langwatch/csv/download";
import { formatMoney } from "@langwatch/design-system/format-money";
import {
  Box,
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Icon,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { toEpochMs } from "@langwatch/time";
import numeral from "numeral";
import { Download } from "react-feather";

import { readableDate } from "../../../model/display-formatters.ts";
import type { ExperimentRow } from "../../../model/experiment-api-map.ts";
import { cellText, readKey } from "../../../model/experiments/BatchEvaluationV2/utils.ts";
import type { BatchEvaluation } from "../../../model/prisma-types.ts";

type EvaluationGroup = {
  all: BatchEvaluation[];
  processed: BatchEvaluation[];
  error: BatchEvaluation[];
  skipped: BatchEvaluation[];
  unknown: BatchEvaluation[];
};
type Metric = "passed" | "score";

const CSV_FIELDS = [
  "Dataset",
  "Evaluation",
  "Input",
  "Output",
  "Expected Output",
  "Passed",
  "Status",
  "Details",
  "Score",
  "Label",
  "Cost",
  "Created at",
];

/** One of the evaluation's `data` fields as text; absent reads empty. */
const dataTextOf = (evaluation: BatchEvaluation, key: string) =>
  cellText(readKey(evaluation.data, key) ?? "");

const csvRowOf = (evaluation: BatchEvaluation) => [
  evaluation.datasetSlug,
  evaluation.evaluation,
  dataTextOf(evaluation, "input"),
  dataTextOf(evaluation, "output"),
  dataTextOf(evaluation, "expected_output"),
  evaluation.passed ? "True" : "False",
  evaluation.status,
  evaluation.details,
  evaluation.score,
  evaluation.label ?? "",
  evaluation.cost,
  readableDate(evaluation.createdAt).toLocaleString(),
];

const runtimeOf = (evaluations: BatchEvaluation[]) => {
  const times = evaluations.map((evaluation) => toEpochMs(evaluation.createdAt));
  return times.length > 0 ? Math.max(...times) - Math.min(...times) : 0;
};

const groupByEvaluation = (evaluations: BatchEvaluation[]): Record<string, EvaluationGroup> => {
  const groups: Record<string, EvaluationGroup> = {};
  for (const evaluation of evaluations) {
    const group = (groups[evaluation.evaluation] ??= {
      all: [],
      processed: [],
      error: [],
      skipped: [],
      unknown: [],
    });
    group.all.push(evaluation);
    group[statusBucket(evaluation.status)].push(evaluation);
  }
  return groups;
};

const metricOf = (group: EvaluationGroup): Metric =>
  group.processed.some((evaluation) => evaluation.score) ? "score" : "passed";

const averageOf = (group: EvaluationGroup, metric: Metric) => {
  const { processed } = group;
  if (metric === "score") {
    return processed.reduce((acc, curr) => acc + curr.score, 0) / processed.length;
  }
  return processed.filter((evaluation) => evaluation.passed).length / processed.length;
};

const StatusDot = ({ color }: { color: string }) => (
  <Box
    display="inline-block"
    background={color}
    borderRadius="100%"
    width={2}
    height={2}
    marginRight={1}
  ></Box>
);

const EvaluationSummaryCard = ({
  name,
  group,
  metric,
}: {
  name: string;
  group: EvaluationGroup;
  metric: Metric;
}) => {
  const score = averageOf(group, metric);
  return (
    <Card.Root>
      <Card.Body>
        <VStack align="start" justify="center" height="full" gap={2}>
          <Text color="fg" fontSize="15px" fontWeight="500">
            {name}
          </Text>
          <HStack align="end" color={score < 0.5 ? "red.500" : "green.500"}>
            <Text fontSize="26px" fontWeight="300">
              {numeral(score).format(metric === "score" ? "0.00" : "0%")}
            </Text>
            <Text fontSize="13px" fontWeight="500" marginBottom="4px" opacity={0.8}>
              {metric === "score" ? "avg score" : "pass rate"}
            </Text>
          </HStack>
          <HStack fontSize="11px" textTransform="uppercase" fontWeight="600" color="fg.muted">
            {group.skipped.length && (
              <Text>
                <StatusDot color="yellow.400" />
                {group.skipped.length} skipped
              </Text>
            )}
            {group.error.length && (
              <Text>
                <StatusDot color="red.400" />
                {group.error.length} error
              </Text>
            )}
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
};

const StatCard = ({ title, value }: { title: string; value: string }) => (
  <Card.Root>
    <Card.Body>
      <VStack align="start" justify="center" height="full" gap={2}>
        <Text color="fg" fontSize="15px" fontWeight="500">
          {title}
        </Text>
        <Text fontSize="26px" fontWeight="300">
          {value}
        </Text>
      </VStack>
    </Card.Body>
  </Card.Root>
);

const LoadingTable = () => (
  <Box>
    <Table.Root variant="line" borderWidth="1px" borderColor="border">
      <Table.Body>
        {Array.from({ length: 3 }).map((_, i) => (
          <Table.Row key={i}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Table.Cell key={i}>
                <Skeleton height="20px" />
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  </Box>
);

const ClampedTextCell = ({ text }: { text: string }) => (
  <Table.Cell>
    <Tooltip content={text}>
      <Text lineClamp={2} display="block" maxWidth={230}>
        {text}
      </Text>
    </Tooltip>
  </Table.Cell>
);

const EvaluationRow = ({
  evaluation,
  isScore,
  hasExpectedOutput,
  hasDetails,
}: {
  evaluation: BatchEvaluation;
  isScore: boolean;
  hasExpectedOutput: boolean;
  hasDetails: boolean;
}) => (
  <Table.Row>
    <ClampedTextCell text={dataTextOf(evaluation, "input")} />
    <ClampedTextCell text={dataTextOf(evaluation, "output")} />
    {hasExpectedOutput && <ClampedTextCell text={dataTextOf(evaluation, "expected_output")} />}
    <Table.Cell color={STATUS_COLORS.get(evaluation.status)}>{evaluation.status}</Table.Cell>
    {evaluation.status === "processed" ? (
      <Table.Cell textAlign="center" fontWeight="500" color={resultColor({ isScore, evaluation })}>
        {resultLabel({ isScore, evaluation })}
      </Table.Cell>
    ) : (
      <Table.Cell textAlign="center">-</Table.Cell>
    )}
    {hasDetails && (
      <Table.Cell maxWidth={300} color={STATUS_COLORS.get(evaluation.status)}>
        <Tooltip content={evaluation.details}>
          <Text lineClamp={1} wordBreak="break-all" display="block">
            {evaluation.details}
          </Text>
        </Tooltip>
      </Table.Cell>
    )}
    <Table.Cell>
      {evaluation.cost ? formatMoney({ amount: evaluation.cost, currency: "USD" }) : "-"}
    </Table.Cell>
    <Table.Cell>{readableDate(evaluation.createdAt).toLocaleString()}</Table.Cell>
  </Table.Row>
);

const EvaluationTable = ({
  name,
  group,
  metric,
}: {
  name: string;
  group: EvaluationGroup;
  metric: Metric;
}) => {
  const hasExpectedOutput = group.all.some((evaluation) =>
    readKey(evaluation.data, "expected_output"),
  );
  const hasDetails = group.all.some((evaluation) => evaluation.details);
  return (
    <VStack align="start" gap={8} paddingTop={12}>
      <Heading as={"h2"} size="md">
        {name}
      </Heading>
      <Box>
        <Table.Root variant="line" borderWidth="1px" borderColor="border">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Input</Table.ColumnHeader>
              <Table.ColumnHeader>Output</Table.ColumnHeader>
              {hasExpectedOutput && <Table.ColumnHeader>Expected Output</Table.ColumnHeader>}
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader minWidth={120} textAlign="center">
                {metric === "score" ? "Score" : "Passed"}
              </Table.ColumnHeader>
              {hasDetails && <Table.ColumnHeader>Details</Table.ColumnHeader>}
              <Table.ColumnHeader>Cost</Table.ColumnHeader>
              <Table.ColumnHeader>Created</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {group.all.map((evaluation, i) => (
              <EvaluationRow
                key={i}
                evaluation={evaluation}
                isScore={metric === "score"}
                hasExpectedOutput={hasExpectedOutput}
                hasDetails={hasDetails}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </VStack>
  );
};

export default function BatchEvaluation({
  experiment,
  evaluations,
}: {
  project: UiHostProject;
  experiment: ExperimentRow;
  evaluations: { data?: BatchEvaluation[]; isLoading: boolean };
}) {
  const data = evaluations.data ?? [];
  const downloadCSV = () =>
    downloadCsv({
      fields: CSV_FIELDS,
      rows: data.map(csvRowOf),
      fileName: `${experiment?.slug}.csv`,
    });

  const totalCost = data.reduce((acc, curr) => acc + curr.cost, 0);
  const runtime = runtimeOf(data);
  const groups = Object.entries(groupByEvaluation(data));
  const isEmpty = !evaluations.isLoading && evaluations.data?.length === 0;
  const showGroups = !evaluations.isLoading && !isEmpty;

  return (
    <Box background="bg.surface" width="full" height="full" paddingTop={14}>
      <Container maxW={"calc(100vw - 200px)"}>
        <HStack width="full" verticalAlign={"middle"} paddingBottom={6}>
          <VStack align="start">
            <Heading as={"h1"} size="lg">
              {experiment.name ?? experiment.slug}
            </Heading>
            <Text>Dataset: {data[0]?.dataset.name ?? ""}</Text>
          </VStack>

          <Spacer />
          <Button
            colorPalette="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() => evaluations.data && downloadCSV()}
          >
            Download Results CSV{" "}
            <Icon marginLeft={2}>
              <Download />
            </Icon>
          </Button>
        </HStack>
      </Container>
      <HStack
        align="center"
        alignItems="stretch"
        justify="center"
        background="gray.50"
        padding={6}
        gap={6}
      >
        {groups.map(([name, group]) => (
          <EvaluationSummaryCard key={name} name={name} group={group} metric={metricOf(group)} />
        ))}
        <StatCard
          title="Evaluations Cost"
          value={totalCost ? formatMoney({ amount: totalCost, currency: "USD" }) : "-"}
        />
        <StatCard
          title="Runtime"
          value={runtime ? numeral(runtime / 1000).format("00:00:00") : "-"}
        />
      </HStack>
      <Box
        width="full"
        paddingBottom={12}
        display="flex"
        justifyContent="center"
        overflowX="auto"
        paddingX={6}
      >
        <VStack align="start" minWidth="0">
          {evaluations.isLoading && <LoadingTable />}
          {isEmpty && <Text>No data found</Text>}
          {showGroups &&
            groups.map(([name, group]) => (
              <EvaluationTable key={name} name={name} group={group} metric={metricOf(group)} />
            ))}
        </VStack>
      </Box>
    </Box>
  );
}

const STATUS_COLORS = new Map<string, string>([
  ["skipped", "yellow.700"],
  ["error", "red.700"],
]);

function statusBucket(status: string): "processed" | "error" | "skipped" | "unknown" {
  if (status === "processed") return "processed";
  if (status === "error") return "error";
  if (status === "skipped") return "skipped";
  return "unknown";
}

function resultColor({
  isScore,
  evaluation,
}: {
  isScore: boolean;
  evaluation: BatchEvaluation;
}): string {
  if (isScore) return evaluation.score < 0.5 ? "red.500" : "green.500";
  return evaluation.passed ? "green.500" : "red.500";
}

function resultLabel({
  isScore,
  evaluation,
}: {
  isScore: boolean;
  evaluation: BatchEvaluation;
}): string {
  if (isScore) return numeral(evaluation.score).format("0.00");
  return evaluation.passed ? "True" : "False";
}
