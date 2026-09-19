/**
 * The control plane end of a hosted-service call (ADR-139).
 *
 * The gateway has authenticated the caller and applied the budget stop; it
 * sends who the caller resolved to beside the caller's own JSON, which stays
 * inside `payload` and can therefore never name another key or organization.
 *
 * The answer is relayed to the caller as it is, so a refusal is written in the
 * gateway's error envelope and not in this app's own.
 */

import { HandledError } from "@langwatch/handled-error";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { prisma } from "~/server/db";
import { createHostedServicesService } from "./connect.prisma";
import type {
  HostedCaller,
  HostedServicesService,
} from "./hostedServices.service";

const hostedServiceEnvelopeSchema = z.object({
  virtual_key_id: z.string().min(1),
  organization_id: z.string().min(1),
  project_id: z.string(),
  payload: z.unknown(),
});

type HostedServiceCall = (args: {
  service: HostedServicesService;
  caller: HostedCaller;
  payload: unknown;
  signal: AbortSignal;
}) => Promise<object>;

const HOSTED_SERVICE_CALLS: Record<string, HostedServiceCall> = {
  "instant-evals-classify": ({ service, caller, payload, signal }) =>
    service.classify({ caller, payload, signal }),
  usage: ({ service, caller }) => service.usage({ caller }),
  budget: ({ service, caller, payload }) =>
    service.setBudget({ caller, payload }),
};

/** Writes a refusal the way the gateway writes its own. */
function gatewayEnvelope(error: HandledError) {
  return {
    error: {
      type: error.code,
      code: error.code,
      message: error.message,
      ...(error.meta ? { meta: error.meta } : {}),
    },
  };
}

/** Hono handler for `POST /api/internal/gateway/connect/:operation`. */
export async function hostedServiceRoute(c: Context) {
  const call = HOSTED_SERVICE_CALLS[c.req.param("operation") ?? ""];
  const envelope = hostedServiceEnvelopeSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!call || !envelope.success) {
    // The gateway's own generic refusal, not one of this app's codes.
    const refusal = "bad_request";
    return c.json(
      {
        error: {
          type: refusal,
          code: refusal,
          message: "unknown hosted service call",
        },
      },
      400,
    );
  }
  try {
    const answer = await call({
      service: createHostedServicesService(prisma),
      caller: {
        virtualKeyId: envelope.data.virtual_key_id,
        organizationId: envelope.data.organization_id,
        projectId: envelope.data.project_id || null,
      },
      payload: envelope.data.payload,
      signal: c.req.raw.signal,
    });
    return c.json(answer);
  } catch (error) {
    // Anything that is not a named refusal stays an ordinary error: the
    // gateway reports a 5xx from here as its own outage, never as an answer.
    if (!HandledError.isHandled(error) || error.httpStatus >= 500) throw error;
    return c.json(
      gatewayEnvelope(error),
      error.httpStatus as ContentfulStatusCode,
    );
  }
}
