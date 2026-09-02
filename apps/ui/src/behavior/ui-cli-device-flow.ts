/**
 * The CLI device-flow exchange, as this application performs it.
 *
 * `/cli/auth` talks to three REST routes the application serves —
 * `GET /api/auth/cli/lookup`, `POST /api/auth/cli/approve` and
 * `POST /api/auth/cli/deny` — and the OTHER SIDE OF THAT EXCHANGE IS THE
 * PUBLISHED CLI: `langwatch login` prints the verification URI, then polls
 * `/exchange` until the record this file flips comes back approved. So the wire
 * is a compatibility surface with a shipped binary, not an internal detail, and
 * it is reproduced here byte for byte from what
 * `platform/app/src/pages/settings/../cli/auth.tsx` sent: the same paths, the
 * same method and header, the same snake-cased body keys, the same reading of
 * 404 and 410 as distinct outcomes, and the same message precedence
 * (`message` before `error_description` before a status-code line).
 *
 * IT LIVES IN THE GLOBAL LAYER RATHER THAN IN THE FEATURE, and that is a rule
 * rather than a preference: `ui-browser-capability` forbids `apps/ui/src/features/*`
 * from naming `fetch`, and `src/behavior/` is the browser-transport home the
 * feature-pilot gate carved out for exactly this. The api-key frontend feature
 * adapts these three functions onto its package's host port.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
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
 * The message a failed response should read as.
 *
 * `message` wins over `error_description` because the approve route can send a
 * handled error's customer-safe message, and it says more than the route's own
 * generic description. A response with neither falls back to naming the action
 * and its status, which is what the page has always shown.
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
 * Approves a device code with the reviewed selection.
 *
 * `project_id` and `key_selection` are included only when the caller supplied
 * them, which is what keeps the body identical to the platform page's: a
 * project login sends the project and no selection, a device session sends the
 * selection and no project.
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
 * Rejects a device code.
 *
 * DENIED EITHER WAY, which is the platform page's behaviour and the right one:
 * a network failure on the way to this route leaves the code to expire by
 * itself, and telling the reader their refusal did not go through would be
 * asking them to worry about something they cannot act on.
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
