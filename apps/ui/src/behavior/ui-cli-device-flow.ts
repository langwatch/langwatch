/**
 * The CLI device-flow exchange — the OTHER SIDE is the published CLI
 * (`langwatch login` polls `/exchange`), so this wire is a compatibility
 * surface reproduced byte for byte. Spec: cli-onboarding/login-unified.feature.
 */

/** Which credential the CLI is asking for. */
export type UiCliCredentialType = "device_session" | "project_api_key";

/** What `GET /api/auth/cli/lookup` answered. */
export type UiCliDeviceCodeLookup =
  | {
      outcome: "pending";
      userCode: string;
      status: string;
      expiresAt: number;
      credentialType: UiCliCredentialType;
    }
  /** 410: the record exists and its deadline has passed. */
  | { outcome: "expired" }
  /** 404: nothing recognises this code. */
  | { outcome: "unknown" }
  | { outcome: "failed"; message: string };

/** The selection an approval carries, in the screen's own vocabulary. */
export type UiCliDeviceApproval = {
  userCode: string;
  organizationId: string;
  projectId?: string;
  keySelection?: {
    bindings: Array<{ scopeType: string; scopeId: string }>;
    permissions: string[];
  };
};

/** What an approve or a deny came back as. */
export type UiCliDeviceActionResult = { outcome: "ok" } | { outcome: "failed"; message: string };

const LOOKUP_PATH = "/api/auth/cli/lookup";
const APPROVE_PATH = "/api/auth/cli/approve";
const DENY_PATH = "/api/auth/cli/deny";

/** The body of a failed response, in the two shapes these routes send. */
type CliErrorBody = { error_description?: string; message?: string };

/**
 * `message` wins over `error_description` — the approve route can send a
 * handled error's customer-safe message there, which says more than the
 * generic description. Neither present: falls back to naming the action and status.
 */
function failureMessage(body: CliErrorBody, action: string, status: number): string {
  return body.message ?? body.error_description ?? `${action} (${status})`;
}

/** The message an exception should read as. Same line the page has always shown. */
function networkMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Network error";
}

export async function lookupCliDeviceCode(userCode: string): Promise<UiCliDeviceCodeLookup> {
  try {
    const response = await fetch(`${LOOKUP_PATH}?user_code=${encodeURIComponent(userCode)}`);
    if (response.status === 410) return { outcome: "expired" };
    if (response.status === 404) return { outcome: "unknown" };
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as CliErrorBody;
      return {
        outcome: "failed",
        message: body.error_description ?? `Lookup failed (${response.status})`,
      };
    }
    const body = (await response.json()) as {
      user_code: string;
      status: string;
      expires_at: number;
      credential_type?: UiCliCredentialType;
    };
    // Defensive: an older deployment may not emit `credential_type`. Default to
    // `device_session` so the existing UX path keeps working.
    const credentialType: UiCliCredentialType =
      body.credential_type === "project_api_key" || body.credential_type === "device_session"
        ? body.credential_type
        : "device_session";
    return {
      outcome: "pending",
      userCode: body.user_code,
      status: body.status,
      expiresAt: body.expires_at,
      credentialType,
    };
  } catch (error) {
    return { outcome: "failed", message: networkMessage(error) };
  }
}

/**
 * `project_id` and `key_selection` are included only when the caller
 * supplied them — a project login sends the project and no selection, a
 * device session sends the selection and no project.
 */
export async function approveCliDeviceCode(
  approval: UiCliDeviceApproval,
): Promise<UiCliDeviceActionResult> {
  try {
    const response = await fetch(APPROVE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_code: approval.userCode,
        organization_id: approval.organizationId,
        ...(approval.projectId ? { project_id: approval.projectId } : {}),
        ...(approval.keySelection
          ? {
              key_selection: {
                bindings: approval.keySelection.bindings.map((binding) => ({
                  scope_type: binding.scopeType,
                  scope_id: binding.scopeId,
                })),
                permissions: approval.keySelection.permissions,
              },
            }
          : {}),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as CliErrorBody;
    if (!response.ok) {
      return {
        outcome: "failed",
        message: failureMessage(body, "Approval failed", response.status),
      };
    }
    return { outcome: "ok" };
  } catch (error) {
    return { outcome: "failed", message: networkMessage(error) };
  }
}

/**
 * DENIED EITHER WAY — a network failure here leaves the code to expire
 * on its own, and telling the reader their refusal failed would ask
 * them to worry about something they cannot act on.
 */
export async function denyCliDeviceCode(userCode: string): Promise<UiCliDeviceActionResult> {
  try {
    await fetch(DENY_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_code: userCode }),
    });
  } catch {
    // Intentionally swallowed: see the docblock.
  }
  return { outcome: "ok" };
}
