import type { IntentContext } from "@langwatch/eventing";
import type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "../intents/trigger-settlement.intent.ts";

export abstract class AutomationSettlementExecutor {
  abstract notifyDigest(payload: NotifyDigestIntent, context: IntentContext): Promise<void>;
  abstract persistMatch(payload: PersistMatchIntent, context: IntentContext): Promise<void>;
  abstract logOverflow(payload: LogOverflowIntent, context: IntentContext): Promise<void>;
}
