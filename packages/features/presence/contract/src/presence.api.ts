import { featureApi } from "@langwatch/runtime-composition";
import type { PresenceService } from "./presence.service.ts";
import type { PresenceStreamService } from "./presence-stream.service.ts";

export interface PresenceApi extends PresenceService, PresenceStreamService {}

export const PresenceApi = featureApi<PresenceApi>("presence");
