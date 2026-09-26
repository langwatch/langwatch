// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Alert, Text, VStack } from "@chakra-ui/react";

import { useGovernancePlan } from "../../../../behavior/governance-session.ts";
import { frameExceedsReadCeiling } from "../../model/costs-window.ts";
import { type TimeFrame } from "../../model/time-controls.ts";

/**
 * What a panel says when its read failed rather than answering nothing.
 *
 * Every panel here renders an unanswered read and an absent figure the same
 * way, so without this a failed refresh lands as a blank beside freshly filled
 * neighbours and reads as no spend. The two states ask the reader for opposite
 * things: an empty window is a finding, a failed read is something to try
 * again.
 */
export function CostPanelUnrefreshed({ height = "220px" }: { height?: string }) {
  return (
    <VStack
      data-testid="cost-panel-unrefreshed"
      align="start"
      justify="center"
      height={height}
      gap={1}
      color="fg.muted"
    >
      <Text fontSize="sm" color="fg">
        This panel could not be brought up to date.
      </Text>
      <Text fontSize="sm">
        Its figures were not read, so none are shown. Refreshing again is worth a try.
      </Text>
    </VStack>
  );
}

/**
 * Said out loud when the frame asks for more history than the reads answer.
 *
 * The Time Frame chip offers Last 2 years because every governance page offers
 * the same four spans, and the cost reads cap their window at a year. Silently
 * serving twelve months under a two-year label is the shape of mistake this
 * whole screen is built to avoid, so the shortfall is stated where the figures
 * are read. Nothing is stated in sample mode: the invented series are not a
 * read and are not clamped.
 */
export function ReadCeilingNotice({
  frame,
  showSample,
}: {
  frame: TimeFrame;
  showSample: boolean;
}) {
  if (showSample || !frameExceedsReadCeiling({ frame })) return null;
  return (
    <Text fontSize="xs" color="fg.muted" data-testid="cost-read-ceiling-note">
      Figures cover the last 12 months. Cost history does not go back further than that yet.
    </Text>
  );
}

/**
 * What a reader sees when the server declined the read.
 *
 * Two causes reach the client as the same tRPC FORBIDDEN, and prose is not
 * evidence — the message is copy and will be rewritten. The plan is, so the
 * live plan tells the two apart: an organization off the Enterprise tier was
 * refused by the gate, and one on it was refused by its own grants. Naming the
 * wrong one sends a customer to the wrong place, so neither sentence guesses.
 *
 * Status `info`, never `error`. Nothing failed, nothing needs retrying, and
 * this is not a state support can fix.
 */
export function CostsRefused() {
  const { isEnterprise } = useGovernancePlan();
  return (
    <Alert.Root status="info" data-testid="cost-lanes-refused">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {isEnterprise
            ? "You do not have access to cost data"
            : "Cost data comes with the Enterprise plan"}
        </Alert.Title>
        <Alert.Description>
          {isEnterprise
            ? "Your role does not open the cost views for this organization. An organization admin can grant it."
            : "This organization's plan does not include the cost views, so no figures were read. Nothing is wrong with your setup."}{" "}
          {/* Phrased as an invitation, not a statement of fact: this notice is
              only ever on screen with the samples turned OFF, so telling the
              reader they are on would be wrong at the exact moment it is read. */}
          Sample data shows what this screen holds once it opens.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
