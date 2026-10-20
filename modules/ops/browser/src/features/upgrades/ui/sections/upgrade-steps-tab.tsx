import { MeterBar } from "@langwatch/design-system/meter-bar";
import {
  Badge,
  Button,
  Collapsible,
  Heading,
  HStack,
  Skeleton,
  Stack,
  Text,
  Wrap,
} from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  isFinished,
  orderReleasesNewestFirst,
  releaseGroupName,
  remainingCount,
  statusTone,
  statusWords,
  tonePalette,
} from "../../model/upgrade-labels.ts";
import type { UpgradeReleaseView, UpgradeStepView } from "../../model/upgrade-view.ts";
import { UpgradePendingSteps } from "./upgrade-pending-steps.tsx";

/** The unfinished counts as badges in their tone, e.g. "3 pending", "1 failed". */
function RemainingBadges({ counts }: { counts: Record<string, number> }) {
  return (
    <Wrap gap={1}>
      {Object.entries(counts)
        .filter(([status, count]) => count > 0 && !isFinished(status))
        .map(([status, count]) => (
          <Badge
            key={status}
            size="sm"
            variant="solid"
            colorPalette={
              statusTone(status) === "neutral" ? "orange" : tonePalette(statusTone(status))
            }
          >
            {count} {statusWords(status)}
          </Badge>
        ))}
    </Wrap>
  );
}

function ReleaseProgress({ release }: { release: UpgradeReleaseView }) {
  if (release.stepCount === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No steps
      </Text>
    );
  }
  const done = release.counts.done ?? 0;
  const notNeeded = release.counts["not-needed"] ?? 0;
  return (
    <Stack gap={1}>
      <MeterBar
        fillRatio={(done + notNeeded) / release.stepCount}
        width="160px"
        height="6px"
        fillColor="green.solid"
      />
      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
        {done} of {release.stepCount} done
        {notNeeded > 0 && ` · ${notNeeded} not needed`}
      </Text>
    </Stack>
  );
}

/** One version's group: its name, what is left and its progress; opening it reads its steps. */
function ReleaseGroup({
  release,
  oldest,
  children,
}: {
  release: UpgradeReleaseView;
  oldest: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const remaining = remainingCount(release.counts);
  return (
    <Collapsible.Root lazyMount open={open} onOpenChange={(event) => setOpen(event.open)}>
      <HStack
        gap={4}
        justify="space-between"
        flexWrap="wrap"
        data-testid={`upgrade-release-${release.release ?? "development"}`}
      >
        <Collapsible.Trigger asChild>
          <Button variant="ghost" size="sm" paddingX={1}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Text as="span" fontFamily="mono" fontWeight="medium">
              {releaseGroupName({ release: release.release, oldest })}
            </Text>
          </Button>
        </Collapsible.Trigger>
        <HStack gap={2} flex={1}>
          {release.installed && (
            <Badge size="sm" colorPalette="green" variant="subtle">
              Installed
            </Badge>
          )}
          {release.image && (
            <Badge size="sm" colorPalette="blue" variant="subtle">
              This image
            </Badge>
          )}
          {remaining > 0 ? (
            <RemainingBadges counts={release.counts} />
          ) : (
            <Text textStyle="sm" color="fg.muted">
              {release.stepCount === 0 ? "Nothing" : "All applied"}
            </Text>
          )}
        </HStack>
        <ReleaseProgress release={release} />
      </HStack>
      <Collapsible.Content paddingTop={3} paddingStart={6}>
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/** Steps (ADR-173 section 7): background work still finishing, then every version's steps. */
export function UpgradeStepsTab({
  releases,
  backgroundSteps = [],
  backgroundLoading = false,
  activeUpcasts,
  onOpenStep,
  onRetryStep,
  retryingStepId,
  releaseSteps,
}: {
  releases: readonly UpgradeReleaseView[];
  /** Background steps not yet done, from `listSteps({ mode: "background" })`. */
  backgroundSteps?: readonly UpgradeStepView[];
  backgroundLoading?: boolean;
  /** The eventing upcaster's "active upcasts" reading, mounted by the screen once it exists. */
  activeUpcasts?: ReactNode;
  onOpenStep: (stepId: string) => void;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  /** One version's steps, read when its group opens. */
  releaseSteps: (release: string | null) => ReactNode;
}) {
  const ordered = orderReleasesNewestFirst(releases);
  const oldest = ordered.findLast((release) => release.release !== null)?.release ?? null;
  return (
    <Stack gap={6}>
      {(backgroundSteps.length > 0 || backgroundLoading || activeUpcasts) && (
        <Stack gap={3}>
          <Heading size="sm">Finishing in background</Heading>
          {backgroundLoading && <Skeleton height="120px" aria-label="Loading background steps" />}
          {backgroundSteps.length > 0 && (
            <UpgradePendingSteps
              group="background"
              steps={backgroundSteps}
              onOpenStep={onOpenStep}
              onRetryStep={onRetryStep}
              retryingStepId={retryingStepId}
            />
          )}
          {activeUpcasts}
        </Stack>
      )}
      <Stack gap={3} data-testid="upgrade-releases">
        {ordered.length === 0 ? (
          <Text textStyle="sm" color="fg.muted">
            The ledger and the image name no steps.
          </Text>
        ) : (
          ordered.map((release) => (
            <ReleaseGroup
              key={release.release ?? "development"}
              release={release}
              oldest={release.release !== null && release.release === oldest}
            >
              {releaseSteps(release.release)}
            </ReleaseGroup>
          ))
        )}
      </Stack>
    </Stack>
  );
}
