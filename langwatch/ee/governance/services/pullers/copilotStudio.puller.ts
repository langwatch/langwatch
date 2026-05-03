/**
 * Microsoft Copilot Studio reference puller — built on top of the
 * generic HttpPollingPullerAdapter with the URL + auth shape locked
 * to Microsoft's documented audit-log API. Admins enable Copilot
 * Studio with one click in the UI; the framework handles polling /
 * pagination / event-mapping.
 *
 * Demonstrates the framework end-to-end. Future reference pullers
 * (openai_compliance, claude_compliance) MUST follow the same
 * pattern: extend HttpPollingPullerAdapter, export a constant
 * `*_PULL_CONFIG` defining the locked URL/auth/mapping shape, and
 * accept ONLY credentials from the admin UI.
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-reference.feature
 */
import {
  HttpPollingPullerAdapter,
  type HttpPollingConfig,
} from "./httpPollingPullerAdapter";
import type { PullResult, PullRunOptions } from "./pullerAdapter";

/**
 * Locked reference config for Microsoft Copilot Studio. The URL +
 * auth shape + JSON-path mappings are FROZEN — admins can only
 * provide credentials, not rewrite the contract. This is the trust
 * boundary: customers can't modify the URL to point at an attacker-
 * controlled endpoint, can't change the mapping to exfiltrate
 * sensitive fields elsewhere, etc.
 *
 * Microsoft's audit-log endpoint shape:
 *   - GET https://graph.microsoft.com/v1.0/auditLogs/directoryAudits
 *   - Authorization: Bearer <oauth2 token>
 *   - Response: { value: [...events...], "@odata.nextLink": "https://..." | undefined }
 *
 * Cursor handling: Microsoft returns a fully-qualified URL as the
 * cursor (`@odata.nextLink`). The HttpPollingPullerAdapter detects
 * absolute URLs and uses them as-is, so we don't need any special
 * pagination handling here.
 */
export const COPILOT_STUDIO_PULL_CONFIG: HttpPollingConfig = {
  adapter: "http_polling",
  url: "https://graph.microsoft.com/v1.0/auditLogs/directoryAudits",
  method: "GET",
  headers: {
    Authorization: "Bearer ${{credentials.token}}",
    Accept: "application/json",
  },
  authMode: "header_template",
  cursorJsonPath: "$['@odata.nextLink']",
  cursorQueryParam: "cursor", // unused — Microsoft returns absolute URLs
  eventsJsonPath: "$.value",
  schedule: "*/15 * * * *",
  eventMapping: {
    source_event_id: "$.id",
    event_timestamp: "$.activityDateTime",
    actor: "$.initiatedBy.user.userPrincipalName",
    action: "$.activityDisplayName",
    target: "$.targetResources[0].displayName",
    extra: {
      category: "$.category",
      result: "$.result",
      correlation_id: "$.correlationId",
    },
  },
};

/**
 * Reference puller wrapping HttpPollingPullerAdapter with the locked
 * config. Admins enable this puller from the admin UI and provide
 * Microsoft Graph credentials (typically via OAuth2 device flow); the
 * worker dispatches via the registry.
 */
export class CopilotStudioReferencePuller extends HttpPollingPullerAdapter {
  override readonly id = "copilot_studio";

  /**
   * Override `validateConfig` to ignore caller-provided overrides
   * and always return the locked reference config. This is the
   * "admins cannot change the URL or mapping" guarantee from the
   * spec — even if a malicious admin tries to inject a different
   * pullConfig, the puller honors only the locked shape.
   *
   * The adapter id ("copilot_studio") is what identifies this
   * reference puller in the registry. The locked config is what
   * gets executed by the underlying HttpPollingPullerAdapter.
   */
  override validateConfig(_config: unknown): HttpPollingConfig {
    return COPILOT_STUDIO_PULL_CONFIG;
  }

  override async runOnce(
    options: PullRunOptions,
    _config: HttpPollingConfig,
  ): Promise<PullResult> {
    return super.runOnce(options, COPILOT_STUDIO_PULL_CONFIG);
  }
}
