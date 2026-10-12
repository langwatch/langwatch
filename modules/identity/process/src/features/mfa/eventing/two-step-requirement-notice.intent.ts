import type { IntentContext } from "@langwatch/eventing";
import type { z } from "zod";

import type {
  notifyMembersIntentSchema,
  TwoStepRequirementNotices,
} from "./two-step-requirement-notice.process.ts";

export function runNotifyMembers(deps: {
  notices: TwoStepRequirementNotices;
}): (payload: z.infer<typeof notifyMembersIntentSchema>, context: IntentContext) => Promise<void> {
  return async (payload, context): Promise<void> => {
    await deps.notices.notifyRequirementChanged({
      notificationKey: context.messageKey,
      organizationId: payload.organizationId,
      actorUserId: payload.actorUserId,
      required: payload.required,
    });
  };
}
