/**
 * The guided kickoff's state lines, settled from the guided state as stored when the turn starts,
 * so the model and the recorded message agree whatever snapshot the panel held.
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { langyMessagePartSchema, type LangyMessagePart } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import {
  findGuidedKickoffParts,
  guidedKickoffStateFactsOf,
  settleGuidedKickoffParts,
  type OnboardingApi,
} from "@langwatch/onboarding-contract";
import { z } from "zod";

const logger = createLogger("langwatch:langy:guided-kickoff");
const messagePartsSchema = z.array(langyMessagePartSchema);

export class LangyGuidedKickoffService {
  private constructor(private readonly onboarding: Pick<OnboardingApi, "getGuidedState">) {}

  static create(input: {
    onboarding: Pick<OnboardingApi, "getGuidedState">;
  }): LangyGuidedKickoffService {
    return new LangyGuidedKickoffService(input.onboarding);
  }

  /** The parts as sent when they carry no kickoff or the guided state cannot be read. */
  async settle({
    parts,
    organizationId,
    userId,
  }: {
    parts: readonly LangyMessagePart[];
    organizationId: string;
    userId: string;
  }): Promise<LangyMessagePart[]> {
    if (findGuidedKickoffParts(parts).length === 0) return [...parts];
    try {
      const state = await this.onboarding.getGuidedState({ organizationId, userId });
      const settled = settleGuidedKickoffParts({
        parts,
        facts: guidedKickoffStateFactsOf(state),
      });
      return messagePartsSchema.parse(settled);
    } catch (error) {
      logger.warn({ error, organizationId }, "guided kickoff left as the panel composed it");
      return [...parts];
    }
  }
}
