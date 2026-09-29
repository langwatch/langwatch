/**
 * The three `/api/auth/cli/*` REST doors the CLI approval screen polls —
 * `auth` owns the state machine, this family only speaks its wire. Fetched
 * directly, not tRPC: the flow's clients poll these exact literal paths.
 */

import type {
  CliDeviceActionResult,
  CliDeviceApproval,
  CliDeviceCodeLookup,
} from "../model/api-key-host.ts";

type LookupBody = {
  user_code: string;
  status: string;
  expires_at: number;
  credential_type: "device_session" | "project_api_key";
  /** Absent from deployments that predate `--management`. */
  management?: boolean;
};

type ErrorBody = { error?: string; error_description?: string };

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Asks the application whether a device code is still pending. */
export async function lookupCliDeviceCode(userCode: string): Promise<CliDeviceCodeLookup> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/cli/lookup?user_code=${encodeURIComponent(userCode)}`, {
      credentials: "include",
    });
  } catch (error) {
    return { outcome: "failed", message: error instanceof Error ? error.message : "network error" };
  }
  if (response.status === 404) return { outcome: "unknown" };
  if (response.status === 410) return { outcome: "expired" };
  if (!response.ok) {
    const body = await readJson<ErrorBody>(response).catch((): ErrorBody => ({}));
    return {
      outcome: "failed",
      message: body.error_description ?? body.error ?? response.statusText,
    };
  }
  const body = await readJson<LookupBody>(response);
  return {
    outcome: "pending",
    userCode: body.user_code,
    status: body.status,
    expiresAt: body.expires_at,
    credentialType: body.credential_type,
    management: body.management === true,
  };
}

async function postCliDeviceFlow(path: string, body: unknown): Promise<CliDeviceActionResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { outcome: "failed", message: error instanceof Error ? error.message : "network error" };
  }
  if (!response.ok) {
    const parsed = await readJson<ErrorBody>(response).catch((): ErrorBody => ({}));
    return {
      outcome: "failed",
      message: parsed.error_description ?? parsed.error ?? response.statusText,
    };
  }
  return { outcome: "ok" };
}

/** Approves a device code with the reviewed selection. */
export function approveCliDeviceCode(approval: CliDeviceApproval): Promise<CliDeviceActionResult> {
  return postCliDeviceFlow("/api/auth/cli/approve", {
    user_code: approval.userCode,
    organization_id: approval.organizationId,
    project_id: approval.projectId,
    key_selection: approval.keySelection
      ? {
          bindings: approval.keySelection.bindings.map((binding) => ({
            scope_type: binding.scopeType,
            scope_id: binding.scopeId,
          })),
          permissions: approval.keySelection.permissions,
        }
      : void 0,
  });
}

/** Rejects a device code. */
export function denyCliDeviceCode(userCode: string): Promise<CliDeviceActionResult> {
  return postCliDeviceFlow("/api/auth/cli/deny", { user_code: userCode });
}
