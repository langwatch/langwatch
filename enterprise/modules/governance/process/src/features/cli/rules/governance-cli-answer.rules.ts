// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { RestProtocolRefusal } from "@langwatch/api/rest";
import {
  IngestionSourceNotFoundError,
  governanceCliRefusalAnswers,
  type GovernanceCliRefusalAnswer,
} from "@langwatch/enterprise-governance-contract";
import { HandledError } from "@langwatch/handled-error";

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

/**
 * Main's CLI wire for the plan and permission refusals the CLI token door asks (Q31):
 * `{ error, error_description, upgrade_url? }`. Every other refusal is declined to the
 * family's boundary, so the door's 401 stays canonical.
 */
export function cliDoorRefusal({
  publicBaseUrl,
}: {
  publicBaseUrl: string | undefined;
}): RestProtocolRefusal {
  const upgradeUrl = `${(publicBaseUrl ?? "http://localhost:5560").replace(/\/+$/, "")}/settings/subscription`;

  return ({ failure, response }) => {
    const answered = cliDoorAnswer({ failure, upgradeUrl });
    if (answered.outcome === "declined") return response.decline();

    return response.write({
      status: answered.answer.status,
      mediaType: "application/json",
      body: JSON.stringify(answered.answer.body),
    });
  };
}

type CliDoorAnswer =
  | Readonly<{ outcome: "written"; answer: GovernanceCliRefusalAnswer }>
  | Readonly<{ outcome: "declined" }>;

function cliDoorAnswer({
  failure,
  upgradeUrl,
}: {
  failure: Error;
  upgradeUrl: string;
}): CliDoorAnswer {
  if (!HandledError.isHandled(failure)) return { outcome: "declined" };

  if (failure.code === "enterprise_plan_required") {
    const body = governanceCliRefusalAnswers[402].parse({
      error: "payment_required",
      error_description: failure.message,
      upgrade_url: upgradeUrl,
    });

    return { outcome: "written", answer: { status: 402, body } };
  }

  const permission = failure.meta?.permission;
  if (failure.code === "permission_denied" && typeof permission === "string") {
    const description = `Missing required permission '${permission}' on this organization`;

    return { outcome: "written", answer: refuse("forbidden", description, 403) };
  }

  return { outcome: "declined" };
}
