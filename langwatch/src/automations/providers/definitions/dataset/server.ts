import { TriggerAction } from "@prisma/client";
import type { ServerDef } from "../../types";

const def: ServerDef = { action: TriggerAction.ADD_TO_DATASET };

export default def;
