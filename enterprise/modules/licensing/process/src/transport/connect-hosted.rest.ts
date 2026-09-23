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
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  hostedCapAnswerSchema,
  hostedClassifyAnswerSchema,
  hostedServiceEnvelopeSchema,
  hostedUsageAnswerSchema,
  LicensingApi,
  type HostedCaller,
} from "@langwatch/enterprise-licensing-contract";

/**
 * Why these routes declare no credential the framework resolves per tenant:
 * the whole gate is the deployment's own gateway secret, verified under this
 * family's paths before any route runs.
 */
const HOSTED_CONNECT_GATE =
  "the Go data plane signs every call with the deployment's own gateway secret, and the hosted Connect door verifies it under this family's paths before any route runs";

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
  .withCredential("internalSecret")
  .withAddressing("literal", { v1Twin: false })

  .post("/api/internal/gateway/connect/instant-evals-classify", "classifyForHostedCaller")
  .withInput(hostedServiceEnvelopeSchema)
  .withAccess(anyAuthenticated({ reason: HOSTED_CONNECT_GATE }))
  .withOutput(hostedClassifyAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ input, app }) =>
    app.classifyForHostedCaller({ caller: callerOf(input), payload: input.payload }),
  )

  .post("/api/internal/gateway/connect/usage", "getHostedUsage")
  .withInput(hostedServiceEnvelopeSchema)
  .withAccess(anyAuthenticated({ reason: HOSTED_CONNECT_GATE }))
  .withOutput(hostedUsageAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ input, app }) => app.getHostedUsage({ caller: callerOf(input) }))

  .post("/api/internal/gateway/connect/budget", "setHostedBudgetCap")
  .withInput(hostedServiceEnvelopeSchema)
  .withAccess(anyAuthenticated({ reason: HOSTED_CONNECT_GATE }))
  .withOutput(hostedCapAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ input, app }) =>
    app.setHostedBudgetCap({ caller: callerOf(input), payload: input.payload }),
  )
  .build();
