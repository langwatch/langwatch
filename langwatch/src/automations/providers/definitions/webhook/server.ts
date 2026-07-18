import { TriggerAction } from "@prisma/client";
import type { ServerDef } from "../../types";

const def: ServerDef = {
  action: TriggerAction.SEND_WEBHOOK,
};

export default def;
