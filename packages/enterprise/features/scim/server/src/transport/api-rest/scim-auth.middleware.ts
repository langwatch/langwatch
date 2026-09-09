// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  ScimProtocolError,
  type ScimError,
  type ScimService,
} from "@langwatch/enterprise-scim-contract";
import { ENTERPRISE_FEATURE_ERRORS } from "@langwatch/enterprise-plan-gate";
import type { MiddlewareHandler } from "hono";

type ScimAuthVariables = {
  scimOrganizationId: string;
};

function refusal(status: number, detail: string): ScimProtocolError {
  const response: ScimError = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  };
  return new ScimProtocolError(response);
}

/** Verifies the SCIM bearer credential and records its tenant for the route. */
export function scimBearerAuth(
  scim: () => ScimService,
): MiddlewareHandler<{ Variables: ScimAuthVariables }> {
  return async (context, next) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw refusal(401, "Bearer token is required");
    }

    const result = await scim().verifyToken({ token: authorization.slice(7) });
    if (result.status === "invalid_token") {
      throw refusal(401, "Bearer token is not valid");
    }
    if (result.status === "plan_not_entitled") {
      throw refusal(403, ENTERPRISE_FEATURE_ERRORS.SCIM);
    }

    context.set("scimOrganizationId", result.organizationId);
    await next();
  };
}
