import { TriggerAction } from "@prisma/client";
import type { ServerDef } from "../../types";

const def: ServerDef = { action: TriggerAction.ADD_TO_ANNOTATION_QUEUE };

export default def;
