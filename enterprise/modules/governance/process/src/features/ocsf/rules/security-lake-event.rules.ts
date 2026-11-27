// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHash } from "node:crypto";

import {
  type OcsfIngestEvent,
  ocsfIngestEventSchema,
  type SecurityLakePullConfig,
} from "@langwatch/enterprise-governance-contract";

export type SecurityLakeObjectRef = { bucket: string; key: string };

/** What one queue message asks for: objects to read, nothing (a test event), or nothing readable. */
export type SecurityLakeNotification =
  | { kind: "objects"; objects: SecurityLakeObjectRef[] }
  | { kind: "ignored" }
  | { kind: "unreadable"; reason: string };

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** S3 event notification keys are URL encoded with '+' for a space; EventBridge keys are not. */
function decodeS3Key(key: string): string {
  try {
    return decodeURIComponent(key.replaceAll("+", " "));
  } catch {
    return key;
  }
}
function parseBody(body: string): Json | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function fromEventBridge(detail: Json): SecurityLakeNotification {
  const bucket = isRecord(detail.bucket) ? str(detail.bucket.name) : "";
  const key = isRecord(detail.object) ? str(detail.object.key) : "";
  if (!bucket || !key) {
    return { kind: "unreadable", reason: "EventBridge detail names no bucket and key" };
  }
  return { kind: "objects", objects: [{ bucket, key }] };
}

function fromS3Record(record: unknown): SecurityLakeObjectRef[] {
  if (!isRecord(record)) return [];
  if (!str(record.eventName).startsWith("ObjectCreated")) return [];
  const s3 = isRecord(record.s3) ? record.s3 : {};
  const bucket = isRecord(s3.bucket) ? str(s3.bucket.name) : "";
  const key = isRecord(s3.object) ? decodeS3Key(str(s3.object.key)) : "";
  return bucket && key ? [{ bucket, key }] : [];
}

function fromS3Records(records: unknown[]): SecurityLakeNotification {
  const objects = records.flatMap(fromS3Record);
  return objects.length > 0 ? { kind: "objects", objects } : { kind: "ignored" };
}

function isSnsEnvelope(message: Json): message is Json & { Message: string } {
  return message.Type === "Notification" && typeof message.Message === "string";
}

/**
 * One SQS message body from the subscriber queue. Accepts the EventBridge "Object Created" shape,
 * the S3 event notification shape, either wrapped in an SNS envelope, and the S3 test event.
 */
export function parseSecurityLakeNotification(body: string, depth = 0): SecurityLakeNotification {
  const message = parseBody(body);
  if (!message) return { kind: "unreadable", reason: "message body is not a JSON object" };
  if (message.Event === "s3:TestEvent") return { kind: "ignored" };
  if (isSnsEnvelope(message) && depth === 0) {
    return parseSecurityLakeNotification(message.Message, depth + 1);
  }
  if (isRecord(message.detail)) {
    // Only a created object has bytes to read; a deletion or restore is acknowledged and dropped.
    const detailType = message["detail-type"];
    if (detailType !== undefined && detailType !== "Object Created") return { kind: "ignored" };
    return fromEventBridge(message.detail);
  }
  if (Array.isArray(message.Records)) return fromS3Records(message.Records);
  return { kind: "unreadable", reason: "message is neither an S3 nor an EventBridge notification" };
}

/**
 * Whether an object belongs to one of the sources the admin picked. Security Lake writes native
 * AWS sources under `aws/<SOURCE>/<version>/...`; an object under no known source is skipped.
 */
export function isSelectedSecurityLakeObject({
  key,
  sources,
}: {
  key: string;
  sources: SecurityLakePullConfig["sources"];
}): boolean {
  const segments = key.split("/");
  const at = segments.indexOf("aws");
  const source = at >= 0 ? segments[at + 1] : undefined;
  return source !== undefined && (sources as readonly string[]).includes(source);
}

/** Parquet values as JSON: INT64 arrives as bigint, TIMESTAMP as Date. */
export function normaliseParquetValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.getTime();
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (Array.isArray(value)) return value.map(normaliseParquetValue);
  if (isRecord(value)) {
    const out: Json = {};
    for (const [key, field] of Object.entries(value)) {
      if (field !== null && field !== undefined) out[key] = normaliseParquetValue(field);
    }
    return out;
  }
  return value;
}

/** Bedrock agent, knowledge base and flow calls. */
const BEDROCK_AGENT_OPERATIONS = [
  "InvokeAgent",
  "InvokeInlineAgent",
  "InvokeFlow",
  "RetrieveAndGenerate",
  "RetrieveAndGenerateStream",
  "Retrieve",
];

/**
 * AWS service endpoints whose invocation calls are AI activity. CloudTrail logs the Bedrock
 * agent calls under bedrock.amazonaws.com, so they are kept under both Bedrock event sources.
 */
const AI_SERVICES: ReadonlyMap<string, (operation: string) => boolean> = new Map([
  [
    "bedrock.amazonaws.com",
    (operation) =>
      [
        "InvokeModel",
        "InvokeModelWithResponseStream",
        "InvokeModelWithBidirectionalStream",
        "Converse",
        "ConverseStream",
        "ApplyGuardrail",
        "StartAsyncInvoke",
        "CreateModelInvocationJob",
        ...BEDROCK_AGENT_OPERATIONS,
      ].includes(operation),
  ],
  [
    "bedrock-agent-runtime.amazonaws.com",
    (operation) => BEDROCK_AGENT_OPERATIONS.includes(operation),
  ],
  ["bedrock-agentcore.amazonaws.com", (operation) => operation.startsWith("Invoke")],
  [
    "sagemaker.amazonaws.com",
    (operation) =>
      ["InvokeEndpoint", "InvokeEndpointAsync", "InvokeEndpointWithResponseStream"].includes(
        operation,
      ),
  ],
]);

function apiOf(event: Json): { service: string; operation: string } {
  const api = isRecord(event.api) ? event.api : {};
  const service = isRecord(api.service) ? str(api.service.name) : "";
  return { service: service.toLowerCase(), operation: str(api.operation) };
}

/** The CloudTrail eventType; a streaming call also records an AwsServiceEvent completion. */
function cloudTrailEventTypeOf(event: Json): string {
  const metadata = isRecord(event.metadata) ? event.metadata : {};
  const unmapped = isRecord(event.unmapped) ? event.unmapped : {};
  return str(metadata.event_code) || str(unmapped.eventType);
}

/** Whether a CloudTrail OCSF event is a call to a model, agent or inference endpoint. */
export function isAiActivityEvent(event: Json): boolean {
  if (cloudTrailEventTypeOf(event) === "AwsServiceEvent") return false;
  const { service, operation } = apiOf(event);
  return AI_SERVICES.get(service)?.(operation) ?? false;
}

const TARGET_FIELDS = ["modelId", "agentId", "endpointName", "agentRuntimeArn", "flowIdentifier"];

function requestDataOf(event: Json): Json {
  const api = isRecord(event.api) ? event.api : {};
  const request = isRecord(api.request) ? api.request : {};
  const data = request.data;
  if (isRecord(data)) return data;
  if (typeof data !== "string") return {};
  return parseBody(data) ?? {};
}

function resourceTargetOf(event: Json): string {
  const resources = Array.isArray(event.resources) ? event.resources : [];
  const uid = resources
    .map((resource) => (isRecord(resource) ? str(resource.uid) || str(resource.name) : ""))
    .find((value) => value.length > 0);
  if (!uid) return "";
  return uid.slice(uid.lastIndexOf("/") + 1);
}

/** The model, agent or endpoint the call targeted: request parameters first, then resources. */
export function aiTargetOf(event: Json): string {
  const data = requestDataOf(event);
  const fromRequest = TARGET_FIELDS.map((field) => str(data[field])).find((v) => v.length > 0);
  return fromRequest ?? resourceTargetOf(event);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, canonical(value[key])]),
  );
}

/** A stable uid for an event that carries none: the hash of its canonical JSON. */
export function stableEventUid(event: Json): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical(event)))
    .digest("hex");
  return `sha256:${digest.slice(0, 48)}`;
}

/**
 * One decoded Parquet row as an OCSF event the governance store accepts, or why it does not fit.
 * A missing metadata.uid gets the stable hash, so a redelivered object writes the same identity.
 */
export function securityLakeRowToEvent(
  row: unknown,
): { kind: "event"; event: OcsfIngestEvent } | { kind: "invalid"; reason: string } {
  const normalised = normaliseParquetValue(row);
  if (!isRecord(normalised)) return { kind: "invalid", reason: "row is not an object" };
  const metadata = isRecord(normalised.metadata) ? { ...normalised.metadata } : {};
  if (!str(metadata.uid)) metadata.uid = stableEventUid(normalised);
  if (!str(metadata.version)) metadata.version = "1.1.0";
  const candidate = { severity_id: 0, ...normalised, metadata };
  const parsed = ocsfIngestEventSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      kind: "invalid",
      reason: `${issue?.path.join(".") ?? "event"}: ${issue?.message ?? ""}`,
    };
  }
  return { kind: "event", event: parsed.data };
}
