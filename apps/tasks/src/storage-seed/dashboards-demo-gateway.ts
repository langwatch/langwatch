/**
 * The dashboards demo's gateway traffic: one virtual key per agent through the public API,
 * then the spend the gateway would have drained for each model call, signed as the gateway.
 * The Go gateway stamps spend with the time it serves a call, so history cannot go through it.
 */
import { createHash, createHmac } from "node:crypto";

import { nowInstant } from "@langwatch/time";

import type { DemoHttp } from "./dashboards-demo-http.ts";
import type { DemoTurn } from "./dashboards-demo-traffic.ts";

const SPEND_PATH = "/api/internal/gateway/spend-commands";
const BATCH = 200;
const POD_ID = "dashboards-demo-seed";

interface VirtualKey {
  id: string;
  name: string;
}

/** The agent's virtual key, made once and found by name on a re-run. */
export async function ensureVirtualKey({
  http,
  name,
}: {
  http: DemoHttp;
  name: string;
}): Promise<VirtualKey> {
  const listed = await http.json<{ data: VirtualKey[] }>({ path: "/api/gateway/v1/virtual-keys" });
  const existing = listed.data.find((key) => key.name === name);
  if (existing) return existing;
  const created = await http.json<{ virtual_key: VirtualKey }>({
    method: "POST",
    path: "/api/gateway/v1/virtual-keys",
    headers: { "Idempotency-Key": `dashboards-demo-vk-${name}` },
    body: { name, description: `Dashboards demo key for ${name}` },
  });
  return created.virtual_key;
}

/** The gateway's provider prefix for a model name. */
function providerOf(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "gemini";
  return "openai";
}

type SpendRecord = { command: "admitSpend" | "confirmSpend" | "failSpend"; payload: object };

type DemoSpan = DemoTurn["body"]["spans"][number];

/** How the call ended, as the gateway reports it: failed with its error, or done with usage. */
function outcomeOf({ span, shared }: { span: DemoSpan; shared: object }): SpendRecord {
  const occurredAt = span.timestamps.finished_at;
  if (span.error?.has_error) {
    const rateLimited = span.error.message?.includes("429") ?? false;
    return {
      command: "failSpend",
      payload: {
        ...shared,
        occurred_at: occurredAt,
        error: {
          type: rateLimited ? "rate_limited" : "provider_timeout",
          http_status: rateLimited ? 429 : 504,
        },
      },
    };
  }
  return {
    command: "confirmSpend",
    payload: {
      ...shared,
      occurred_at: occurredAt,
      duration_ms: occurredAt - span.timestamps.started_at,
      usage: {
        input_tokens: span.metrics?.prompt_tokens ?? 0,
        output_tokens: span.metrics?.completion_tokens ?? 0,
      },
    },
  };
}

/** Admit and outcome records for each model call the project has no spend for, ids by span. */
export function spendRecordsFor({
  turns,
  projectId,
  organizationId,
  virtualKeyId,
  held,
}: {
  turns: readonly DemoTurn[];
  projectId: string;
  organizationId: string;
  virtualKeyId: string;
  /** Gateway request ids whose spend the project already holds. */
  held: ReadonlySet<string>;
}): SpendRecord[] {
  return turns.flatMap((turn) =>
    turn.body.spans.flatMap((span): SpendRecord[] => {
      if (span.type !== "llm" || !("model" in span) || !span.model) return [];
      const digest = createHash("sha256").update(span.span_id).digest("hex").slice(0, 30);
      const requestId = `gwreq_${digest}`;
      if (held.has(requestId)) return [];
      const shared = {
        gateway_request_id: requestId,
        project_id: projectId,
        organization_id: organizationId,
        virtual_key_id: virtualKeyId,
        trace_id: turn.body.trace_id,
        request_type: "chat",
        model: `${providerOf(span.model)}/${span.model}`,
        admitted_at: span.timestamps.started_at,
      };
      return [
        { command: "admitSpend", payload: { ...shared, occurred_at: span.timestamps.started_at } },
        outcomeOf({ span, shared }),
      ];
    }),
  );
}

/** Drains the records the way the gateway does: batches, each signed with the gateway secret. */
export async function sendSpend({
  http,
  records,
  secret,
}: {
  http: DemoHttp;
  records: readonly SpendRecord[];
  secret: string;
}): Promise<void> {
  const batches: SpendRecord[][] = [];
  for (let start = 0; start < records.length; start += BATCH) {
    batches.push(records.slice(start, start + BATCH));
  }
  await http.forEach({
    items: batches.map((batch, index) => ({ batch, index })),
    each: async ({ batch, index }) => {
      const body = JSON.stringify({
        records: batch.map((record, offset) => ({
          ...record,
          pod_id: POD_ID,
          pod_seq: index * BATCH + offset,
        })),
      });
      await http.send({
        method: "POST",
        path: SPEND_PATH,
        body,
        headers: signatureHeaders({ secret, path: SPEND_PATH, body }),
      });
    },
  });
}

/** The gateway's request signature: HMAC over method, path, unix seconds and the body hash. */
function signatureHeaders({
  secret,
  path,
  body,
}: {
  secret: string;
  path: string;
  body: string;
}): Record<string, string> {
  const timestamp = String(Math.floor(nowInstant().epochMilliseconds / 1000));
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret)
    .update(`POST\n${path}\n${timestamp}\n${bodyHash}`)
    .digest("hex");
  return {
    "X-LangWatch-Gateway-Signature": signature,
    "X-LangWatch-Gateway-Timestamp": timestamp,
  };
}
