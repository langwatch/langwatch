// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The control-plane end of a hosted-service call (ADR-156), at
 * `/api/internal/gateway/connect/*`.
 *
 * The gateway has authenticated the caller and applied the budget stop; it
 * sends who the caller resolved to beside the caller's own JSON, which stays
 * inside `payload` and can therefore never name another key or organization.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { jsonTextField } from "@langwatch/api/json-text-field";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  requestValidationErrorFrom,
} from "@langwatch/api/rest";
import {
  hostedCapAnswerSchema,
  hostedClassifyAnswerSchema,
  hostedServiceEnvelopeSchema,
  hostedUsageAnswerSchema,
  LicensingApi,
  type HostedCaller,
} from "@langwatch/enterprise-licensing-contract";
import { resolveRequestBound } from "@langwatch/plans";

/**
 * Why these routes declare no credential the framework resolves per tenant:
 * the whole gate is the deployment's own gateway secret, verified under this
 * family's paths before any route runs.
 */
const HOSTED_CONNECT_GATE =
  "the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");
const JSON_MEDIA_TYPE = "application/json";
const SIGNED_BODY = "the gateway's signature covers the exact bytes it sent";

const envelopeOfText = jsonTextField(hostedServiceEnvelopeSchema);

/** The envelope, read from the bytes the door verified; a malformed one is the framework's 422. */
function envelopeOf(raw: string) {
  const parsed = envelopeOfText.safeParse(raw);
  if (!parsed.success) {
    throw requestValidationErrorFrom({ target: "json", error: parsed.error, input: raw });
  }
  return parsed.data;
}

/** The caller the gateway resolved, never one the body claims for itself. */
function callerOf(input: {
  virtual_key_id: string;
  organization_id: string;
  project_id: string;
}): HostedCaller {
  return {
    virtualKeyId: input.virtual_key_id,
    organizationId: input.organization_id,
    projectId: input.project_id || null,
  };
}

export const connectHostedRest = defineRestRouter(LicensingApi)
  .withNamespace("connect-hosted")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("internal_secret")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/internal/gateway/connect/instant-evals-classify", "classifyForHostedCaller")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE, because: SIGNED_BODY })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: HOSTED_CONNECT_GATE }))
  .withOutput(hostedClassifyAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ raw, app, signal }) => {
    const envelope = envelopeOf(raw);
    return app.classifyForHostedCaller({
      caller: callerOf(envelope),
      payload: envelope.payload,
      ...(signal ? { signal } : {}),
    });
  })

  .post("/api/internal/gateway/connect/usage", "getHostedUsage")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE, because: SIGNED_BODY })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: HOSTED_CONNECT_GATE }))
  .withOutput(hostedUsageAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ raw, app }) => app.getHostedUsage({ caller: callerOf(envelopeOf(raw)) }))

  .post("/api/internal/gateway/connect/budget", "setHostedBudgetCap")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE, because: SIGNED_BODY })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: HOSTED_CONNECT_GATE }))
  .withOutput(hostedCapAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ raw, app }) => {
    const envelope = envelopeOf(raw);
    return app.setHostedBudgetCap({ caller: callerOf(envelope), payload: envelope.payload });
  })
  .build();
