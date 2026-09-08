import { featureApi } from "@langwatch/runtime-composition";
import type { ShareService } from "./share.service.ts";

export interface ShareApi extends ShareService {}

export const ShareApi = featureApi<ShareApi>("share");
