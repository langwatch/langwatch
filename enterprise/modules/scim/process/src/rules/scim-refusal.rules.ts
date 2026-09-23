// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { type ScimError, ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import { HandledError } from "@langwatch/handled-error";

const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

/**
 * The RFC 7644 error document a SCIM caller is answered with for any failure.
 * A protocol refusal is its own document; any other handled refusal carries its
 * code in `scimType`; anything unhandled is a 500 that says nothing more.
 */
export function scimRefusalDocument(failure: Error): ScimError {
  if (failure instanceof ScimProtocolError) return failure.response;

  if (HandledError.isHandled(failure)) {
    return {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(failure.httpStatus ?? 500),
      scimType: failure.code,
      detail: failure.message,
    };
  }

  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: "500",
    detail: "The request could not be completed",
  };
}
