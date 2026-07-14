import { TriggerAction } from "@prisma/client";
import type { ServerDef } from "../../types";

/**
 * Stage A stub. The existing dispatch path
 * (`triggerActionDispatch.ts` → `sendTriggerEmail`) handles email
 * delivery today; Stage B will move that code in here and add proper
 * `dispatch(...)` + `testFire(...)` methods. Until then this exists so
 * the parity test (every TriggerAction has a server registration) passes.
 */
const def: ServerDef = {
  action: TriggerAction.SEND_EMAIL,
};

export default def;
