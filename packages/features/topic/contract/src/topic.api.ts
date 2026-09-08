import { featureApi } from "@langwatch/runtime-composition";
import type { TopicService } from "./topic.service.ts";

export interface TopicApi extends TopicService {}

export const TopicApi = featureApi<TopicApi>("topic");
