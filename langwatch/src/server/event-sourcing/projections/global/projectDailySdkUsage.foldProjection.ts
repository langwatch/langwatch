import type { Event } from "../../library/domain/types";
import type { FoldProjectionDefinition } from "../../library/projections/foldProjection.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../pipelines/trace-processing/schemas/constants";
import type { SpanReceivedEventData } from "../../pipelines/trace-processing/schemas/events";
import {
  projectDailySdkUsageStore,
  type ProjectDailySdkUsageState,
} from "./projectDailySdkUsage.store";

export const PROJECT_DAILY_SDK_USAGE_PROJECTION_VERSION =
  "2026-02-16" as const;

function toUTCDateString(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split("T")[0]!;
}

export interface SdkInfo {
  sdkName: string;
  sdkVersion: string;
  sdkLanguage: string;
}

const ATTRIBUTE_KEY_MAP: Record<string, keyof SdkInfo> = {
  "langwatch.sdk.name": "sdkName",
  "langwatch.sdk.version": "sdkVersion",
  "langwatch.sdk.language": "sdkLanguage",
};

const TELEMETRY_ATTRIBUTE_KEY_MAP: Record<string, keyof SdkInfo> = {
  "telemetry.sdk.name": "sdkName",
  "telemetry.sdk.version": "sdkVersion",
  "telemetry.sdk.language": "sdkLanguage",
};

const OTHER_SDK: SdkInfo = {
  sdkName: "other",
  sdkVersion: "",
  sdkLanguage: "",
};

function isCompleteSdkInfo(info: Partial<SdkInfo>): info is SdkInfo {
  return !!info.sdkName && !!info.sdkVersion && !!info.sdkLanguage;
}

/**
 * Extracts SDK info from a generic Event.
 *
 * Only SPAN_RECEIVED events carry resource attributes with SDK metadata.
 * All other event types return the "other" bucket.
 *
 * Prefers `langwatch.sdk.*` attributes (new SDKs). Falls back to `telemetry.sdk.*`
 * only if the name contains "langwatch" (to avoid capturing non-LangWatch OTel SDKs).
 */
export function extractSdkInfoFromEvent(event: Event): SdkInfo {
  if (event.type !== SPAN_RECEIVED_EVENT_TYPE) {
    return OTHER_SDK;
  }

  const data = event.data as SpanReceivedEventData;
  if (!data.resource) {
    return OTHER_SDK;
  }

  const langwatch: Partial<SdkInfo> = {};
  const telemetry: Partial<SdkInfo> = {};

  for (const attr of data.resource.attributes) {
    const val = attr.value.stringValue ?? undefined;
    if (!val) continue;

    const lwField = ATTRIBUTE_KEY_MAP[attr.key];
    if (lwField) {
      langwatch[lwField] = val;
      continue;
    }

    const telField = TELEMETRY_ATTRIBUTE_KEY_MAP[attr.key];
    if (telField) {
      telemetry[telField] = val;
    }
  }

  if (isCompleteSdkInfo(langwatch)) {
    return langwatch;
  }

  if (isCompleteSdkInfo(telemetry) && telemetry.sdkName.includes("langwatch")) {
    return telemetry;
  }

  return OTHER_SDK;
}

/**
 * Global fold projection that tracks SDK version usage per project per day,
 * segmented by SDK name/version/language.
 *
 * Only listens to span_received events (trace ingestion).
 *
 * - key: projectId:date:sdkName:sdkVersion:sdkLanguage
 * - registered globally — receives events from all pipelines
 * - Uses atomic SQL increment (store handles everything, apply is pass-through)
 */
export const projectDailySdkUsageProjection: FoldProjectionDefinition<
  ProjectDailySdkUsageState,
  Event
> = {
  name: "projectDailySdkUsage",
  version: PROJECT_DAILY_SDK_USAGE_PROJECTION_VERSION,
  eventTypes: [SPAN_RECEIVED_EVENT_TYPE],

  key: (event) => {
    const { sdkName, sdkVersion, sdkLanguage } = extractSdkInfoFromEvent(event);
    const date = toUTCDateString(event.timestamp);
    return `${String(event.tenantId)}:${date}:${sdkName}:${sdkVersion}:${sdkLanguage}`;
  },

  init: () => ({
    projectId: "",
    date: "",
    sdkName: "",
    sdkVersion: "",
    sdkLanguage: "",
    count: 0,
    lastEventTimestamp: null,
  }),

  apply(state, event) {
    const { sdkName, sdkVersion, sdkLanguage } = extractSdkInfoFromEvent(event);
    return {
      projectId: String(event.tenantId),
      date: toUTCDateString(event.timestamp),
      sdkName,
      sdkVersion,
      sdkLanguage,
      count: state.count + 1, // Ignored — Prisma upsert handles the count
      lastEventTimestamp: event.timestamp,
    };
  },

  store: projectDailySdkUsageStore,
};
