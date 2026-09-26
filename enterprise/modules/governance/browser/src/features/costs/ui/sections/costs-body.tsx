// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Alert, Skeleton, VStack } from "@chakra-ui/react";
import { type GovernanceCostSummary } from "@langwatch/enterprise-governance-contract";

import { summaryHoldsFigures } from "../../model/measured-rows.ts";
import { sampleCostSummary } from "../../model/sample-lanes.ts";
import { type TimeInterval } from "../../model/time-controls.ts";
import { CostLanes } from "./cost-lanes.tsx";
import { CostsRefused } from "./costs-notices.tsx";

/**
 * The body's states, kept in one place so no branch can quietly acquire a zero:
 * sample, loading, refused read, failed read, unavailable, and figures.
 *
 * Sample comes first on purpose. It is the reader's explicit "show me what
 * this looks like", and the three states below it are all ways of saying we
 * have nothing to show — exactly what sample mode is there to answer.
 */
export function CostsBody({
  isLoading,
  isError,
  refused,
  data,
  interval,
  showSample,
  samplePeriods,
}: {
  isLoading: boolean;
  isError: boolean;
  /** The read was declined, not broken. See `isRefusedRead`. */
  refused: boolean;
  data: GovernanceCostSummary | undefined;
  interval: TimeInterval;
  showSample: boolean;
  samplePeriods: string[];
}) {
  const holdsFigures = summaryHoldsFigures(data, isError);
  if (showSample) {
    return <CostLanes data={sampleCostSummary(samplePeriods)} interval={interval} sample />;
  }

  if (holdsFigures) {
    return <CostLanes data={data} interval={interval} sample={false} />;
  }

  return (
    <CostsWithoutFigures isLoading={isLoading} isError={isError} refused={refused} data={data} />
  );
}

/**
 * Every state that is not a chart, in the order they answer: still reading,
 * declined, broken, and an account with nothing recorded against it.
 *
 * Split out so the one branch that draws money is a single line, and so the
 * four ways of having nothing to show sit together where the difference
 * between them is easy to read. That difference is the whole point — each says
 * something different about whose problem it is, and the page used to answer
 * three of them with the same red alert.
 */
function CostsWithoutFigures({
  isLoading,
  isError,
  refused,
  data,
}: {
  isLoading: boolean;
  isError: boolean;
  refused: boolean;
  data: GovernanceCostSummary | undefined;
}) {
  if (isLoading) {
    return (
      <VStack align="stretch" gap={4} data-testid="cost-lanes-loading">
        <Skeleton height="120px" />
        <Skeleton height="260px" />
      </VStack>
    );
  }

  // A declined read is not a broken one. The plan gate and the permission
  // check both answer before any cost is read, so nothing was attempted and
  // nothing failed — telling the reader something went wrong would send them
  // to support over an account setting. Named ahead of the outage branch
  // because "we refused" is the more specific answer wherever both are true.
  if (refused) {
    return <CostsRefused />;
  }

  // A failed read is an outage, not an empty account. Rendering the lanes with
  // zeros here would state that nothing was spent, which we do not know.
  if (isError || !data) {
    return (
      <Alert.Root status="error" data-testid="cost-lanes-error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Cost data could not be loaded</Alert.Title>
          <Alert.Description>
            Something went wrong reading your cost figures. Try again in a moment. Nothing is shown
            rather than a total we cannot stand behind.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return (
    <Alert.Root status="info" data-testid="cost-lanes-unavailable">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Cost data is unavailable</Alert.Title>
        <Alert.Description>
          {data.unavailableReason === "no_cost_store"
            ? "This deployment does not have cost storage configured, so no cost has been recorded."
            : "No cost has been recorded for this organization yet."}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
