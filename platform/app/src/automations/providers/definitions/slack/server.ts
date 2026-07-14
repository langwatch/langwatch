import { TriggerAction } from "@prisma/client";
import type { ServerDef } from "../../types";

const def: ServerDef = {
  action: TriggerAction.SEND_SLACK_MESSAGE,
};

export default def;
