import { TriggerAction } from "@langwatch/automation-contract";
import type { ServerDef } from "../types";

const def: ServerDef = {
  action: TriggerAction.SEND_EMAIL,
};

export default def;
