import { moduleApi } from "@langwatch/kernel/module-api";

/** The instant-eval capability. Operations arrive with the port of the process half. */
export interface InstantEvalApi {}

export const InstantEvalApi = moduleApi<InstantEvalApi>()("instant-eval");
