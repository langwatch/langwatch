/**
 * The image's one preload (`node --import @langwatch/observability/register`):
 * patches libraries before the app imports them. The patches record into the
 * global provider, which the process's telemetry registers after config parse.
 */
import { register } from "node:module";

import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { OpenAIInstrumentation } from "@opentelemetry/instrumentation-openai";

import {
  type InstrumentationName,
  redisStatementSerializer,
  selectInstrumentations,
} from "./node/node-instrumentations.ts";

const instrumentationFor = {
  "aws-sdk": () => new AwsInstrumentation(),
  openai: () => new OpenAIInstrumentation(),
  ioredis: () =>
    new IORedisInstrumentation({
      requireParentSpan: true,
      dbStatementSerializer: redisStatementSerializer,
    }),
} satisfies Record<InstrumentationName, () => unknown>;

const { names, unknown } = selectInstrumentations({
  enabled: process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS,
  disabled: process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS,
});
if (unknown.length > 0) {
  process.stderr.write(`[observability] unknown instrumentations ignored: ${unknown.join(", ")}\n`);
}
if (names.length > 0) {
  // Wrap only node_modules: a wrapped workspace .ts module is re-emitted unstripped and breaks boot.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url, {
    data: { include: [/\/node_modules\//] },
  });
  registerInstrumentations({ instrumentations: names.map((name) => instrumentationFor[name]()) });
}
