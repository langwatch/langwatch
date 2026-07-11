import { HStack, Text } from "@chakra-ui/react";
import { memo } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { CodeAgentActivity, CodeAgentStep } from "../hooks/useCodeAgentActivity";

/**
 * What a coding-agent interaction did, in the order it did it.
 *
 * An interaction is a unit of WORK, not an exchange: one prompt, then any number
 * of model calls, tool runs and sub-agents. A row showing only the prompt and
 * the final reply cannot tell "answered in one shot" apart from "ran forty
 * tools, got cut off, cost $4".
 *
 * Rendered as a SEQUENCE rather than a tally. Counts would say "Bash 2, Read 2,
 * Edit 1" and lose the story; the order says it read the files, ran the tests,
 * fixed one, and re-ran them. A step that failed is marked where it happened,
 * because a command that failed BEFORE an edit means something quite different
 * from one that failed after.
 *
 * One line, never wrapping: the trace list is virtualized on a fixed row height,
 * so a taller cell would break it. Steps past the inline budget collapse into a
 * "+N", and the tooltip always carries the sequence in full.
 */

/** Steps shown inline. Past this they collapse; the tooltip keeps them all. */
const MAX_INLINE_STEPS = 6;

interface InteractionActivityProps {
  activity: CodeAgentActivity;
  /** The drawer header can afford more room than a list cell. */
  maxInlineSteps?: number;
}

export const InteractionActivity = memo(function InteractionActivity({
  activity,
  maxInlineSteps = MAX_INLINE_STEPS,
}: InteractionActivityProps) {
  if (!activity.hasActivity) return null;

  const { steps } = activity;
  const inline = steps.slice(0, maxInlineSteps);
  const hiddenCount = steps.length - inline.length;

  return (
    <Tooltip content={<ActivityDetail activity={activity} />} openDelay={200}>
      <HStack
        gap={1}
        minWidth={0}
        whiteSpace="nowrap"
        textStyle="xs"
        color="fg.muted"
        aria-label={describe(activity)}
      >
        {inline.map((step, index) => (
          <HStack key={index} gap={1} flexShrink={0}>
            {index > 0 && (
              <Text color="fg.subtle" aria-hidden>
                ›
              </Text>
            )}
            <StepLabel step={step} />
          </HStack>
        ))}

        {hiddenCount > 0 && (
          <Text color="fg.subtle" flexShrink={0}>
            {`+${hiddenCount}`}
          </Text>
        )}

        {/* Flags that change what the row MEANS, so they earn a slot even when
            the steps are collapsed. */}
        {activity.isTruncated && <Flag tone="red">Cut off</Flag>}
        {activity.wasCompacted && <Flag tone="yellow">Compacted</Flag>}
      </HStack>
    </Tooltip>
  );
});

function StepLabel({ step }: { step: CodeAgentStep }) {
  return (
    <Text
      color={step.failed ? "red.fg" : "fg.muted"}
      fontWeight={step.failed ? "medium" : undefined}
      flexShrink={0}
    >
      {step.name}
      {step.count > 1 && (
        <Text as="span" color="fg.subtle">
          {` ×${step.count}`}
        </Text>
      )}
    </Text>
  );
}

function Flag({
  tone,
  children,
}: {
  tone: "red" | "yellow";
  children: string;
}) {
  return (
    <Text
      color={tone === "red" ? "red.fg" : "yellow.fg"}
      fontWeight="medium"
      flexShrink={0}
    >
      {children}
    </Text>
  );
}

/**
 * The full picture, for the tooltip. The inline strip is a summary, so this must
 * be COMPLETE — every step in order, every count — or the summary would be
 * hiding things the reader has no other way to find.
 */
function ActivityDetail({ activity }: { activity: CodeAgentActivity }) {
  return (
    <>
      <Text textStyle="2xs" fontWeight="semibold">
        {describe(activity)}
      </Text>

      {activity.steps.length > 0 && (
        <Text textStyle="2xs" marginTop={1} whiteSpace="normal">
          {activity.steps
            .map((s) => {
              const label = s.count > 1 ? `${s.name} ×${s.count}` : s.name;
              return s.failed ? `${label} (failed)` : label;
            })
            .join(" › ")}
        </Text>
      )}

      {activity.skills.length > 0 && (
        <Text textStyle="2xs" marginTop={1}>
          {`Skills: ${activity.skills.join(", ")}`}
        </Text>
      )}

      {activity.subAgents > 0 && (
        <Text textStyle="2xs" marginTop={1} whiteSpace="normal">
          {activity.subAgentTypes.length > 0
            ? `Ran ${plural(activity.subAgents, "sub-agent")} (${activity.subAgentTypes.join(", ")}). Their own steps are nested under the step that started them, not shown inline above.`
            : `Ran ${plural(activity.subAgents, "sub-agent")}. Their own steps are nested under the step that started them.`}
        </Text>
      )}

      {activity.wasCompacted && (
        <Text textStyle="2xs" marginTop={1}>
          The context was compacted, so it answered from a summary of the
          conversation rather than the whole thing.
        </Text>
      )}

      {activity.isTruncated && (
        <Text textStyle="2xs" marginTop={1}>
          The reply was cut off before it finished.
        </Text>
      )}
    </>
  );
}

/**
 * A one-line plain-English summary. Doubles as the accessible name, so a screen
 * reader gets the same thing a sighted reader does rather than a run of tool
 * names with no context.
 */
export function describe(activity: CodeAgentActivity): string {
  const parts: string[] = [];

  if (activity.slashCommand) parts.push(`/${activity.slashCommand}`);
  if (activity.modelCalls > 0) {
    parts.push(plural(activity.modelCalls, "model call"));
  }
  if (activity.toolCalls > 0) {
    parts.push(plural(activity.toolCalls, "tool run"));
  }
  if (activity.subAgents > 0) {
    parts.push(plural(activity.subAgents, "sub-agent"));
  }
  if (activity.failedTools > 0) {
    parts.push(`${plural(activity.failedTools, "tool")} failed`);
  }
  if (activity.apiErrors > 0) {
    parts.push(plural(activity.apiErrors, "retry"));
  }

  return parts.length > 0 ? parts.join(", ") : "No activity recorded";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
