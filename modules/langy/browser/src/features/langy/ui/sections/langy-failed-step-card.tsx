/**
 * The card a failed step draws. A plan limit and a Slack automation that named no connection are
 * decisions the reader can make, so each gets the card that lets them make it, instead of the
 * failure card and never beside it, and neither folds away once the turn answers.
 */
import {
  isSlackConnectionRefusal,
  refusedSlackChannel,
} from "../../model/logic/langy-slack-connection-prompt.ts";
import type { LangyToolErrorPresentation } from "../../model/logic/langy-tool-failure.ts";
import { LangySlackConnectionCard } from "./automations/langy-slack-connection-card.tsx";
import { LangyPlanLimitCard } from "./langy-plan-limit-card.tsx";
import { LangyToolErrorCard } from "./langy-tool-error-card.tsx";

interface FailedStep {
  call: { name: string; input: unknown };
  presentation: LangyToolErrorPresentation;
}

/** True when the failure asks the reader to decide rather than reports. */
export function isReaderDecision({ call, presentation }: FailedStep): boolean {
  return !!presentation.limit || isSlackConnectionRefusal(call);
}

export function LangyFailedStepCard({ call, presentation }: FailedStep) {
  if (presentation.limit) return <LangyPlanLimitCard presentation={presentation} />;
  if (isSlackConnectionRefusal(call)) {
    return (
      <LangySlackConnectionCard
        reason={presentation.detail ?? presentation.message}
        channel={refusedSlackChannel(call)}
      />
    );
  }
  return <LangyToolErrorCard presentation={presentation} />;
}
