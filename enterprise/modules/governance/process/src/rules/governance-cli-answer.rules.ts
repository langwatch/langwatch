// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  IngestionSourceNotFoundError,
  governanceCliRefusalAnswers,
  type GovernanceCliRefusalAnswer,
} from "@langwatch/enterprise-governance-contract";

/** The answer bodies every `/api/auth/cli` route shares: success, created, refusal. */
export function ok<Body>(
  schema: { parse(body: unknown): Body },
  body: unknown,
): { status: 200; body: Body } {
  return { status: 200, body: schema.parse(body) };
}

export function created<Body>(
  schema: { parse(body: unknown): Body },
  body: unknown,
): { status: 201; body: Body } {
  return { status: 201, body: schema.parse(body) };
}

/** Main's CLI refusal body for an unknown source; anything else propagates. */
export function refuseAbsentSource(error: unknown): {
  status: 404;
  body: GovernanceCliRefusalAnswer["body"];
} {
  if (error instanceof IngestionSourceNotFoundError) {
    return refuse("not_found", "IngestionSource not found", 404);
  }
  throw error;
}

export function refuse<Status extends GovernanceCliRefusalAnswer["status"]>(
  error: string,
  error_description: string,
  status: Status,
): { status: Status; body: GovernanceCliRefusalAnswer["body"] } {
  return {
    status,
    body: governanceCliRefusalAnswers[status].parse({ error, error_description }),
  };
}

export function posted(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
