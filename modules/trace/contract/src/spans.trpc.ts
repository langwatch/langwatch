/**
 * Every `spans.*` procedure, declared once. Both take `traces:view` - a span
 * is trace content, and nothing here is readable to a caller who may not read
 * the trace it belongs to.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { promptStudioSpanSchema, spansForTraceSchema } from "./trace.responses.ts";

const traceScopeSchema = z.object({ projectId: z.string(), traceId: z.string() });
const spanScopeSchema = z.object({ projectId: z.string(), spanId: z.string() });

export const spansTrpc = defineTrpcContract("spans")
  .query("getAllForTrace")
  .withInput(traceScopeSchema)
  .withOutput(spansForTraceSchema)

  .query("getForPromptStudio")
  .withInput(spanScopeSchema)
  .withOutput(promptStudioSpanSchema)
  .build();
