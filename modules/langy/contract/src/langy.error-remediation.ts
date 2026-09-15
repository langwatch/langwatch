type Remediation = { tips?: readonly string[]; docsUrl?: string };

const tips: Record<string, readonly string[]> = {
  langy_conversation_not_found: [
    "Check the conversation id — it may be archived or belong to another project",
    "Start a new conversation to keep going",
  ],
  langy_conversation_not_owned: [
    "Shared conversations can be viewed but only the owner can continue them — start a new conversation instead",
  ],
  langy_conversation_id_unadoptable: [
    "Retry with a different conversation id, or omit `conversationId` to let the server generate one",
  ],
  langy_model_not_configured: ["Pick a model in the project's model settings, then retry"],
  langy_model_not_allowed: ["Choose one of the models configured for this project and retry"],
  langy_egress_misconfigured: [
    "Ask a workspace admin to review the project's outbound network policy — Langy refuses to run rather than leak",
  ],
  langy_insufficient_scope: ["Ask a workspace admin to grant Langy permissions in this project"],
  langy_turn_in_progress: [
    "Wait for the current response to finish before sending another message",
  ],
  langy_rate_limited: ["Wait a few seconds before sending another message"],
  langy_turn_not_stoppable: [
    "Read the conversation to find the turn it currently has in flight, and stop that one",
    "A turn that already finished needs no stopping — its answer is on the conversation",
  ],
  langy_idempotency_mismatch: [
    "The same idempotency key was reused with different content — mint a fresh key for every new send",
  ],
  langy_empty_message: ["Send a message with actual text content"],
  langy_dispatch_rejected: [
    "The agent rejected this turn's request as invalid — it will not be retried; send a new message",
  ],
  langy_agent_unavailable: [
    "Retry in a few seconds — the agent is down, mid-deploy, or restarting",
  ],
  langy_agent_at_capacity: [
    "Too many conversations are running at once — wait a few seconds and retry",
  ],
  langy_agent_session_lost: [
    "The agent dropped this conversation before finishing — resend the message to pick it back up",
  ],
  langy_github_not_connected: [
    "Install the LangWatch GitHub App (Settings → Integrations) to let the agent open pull requests",
  ],
  langy_api_credential_missing: [
    "Send the project API key as X-Auth-Token, Authorization: Bearer <token>, or Authorization: Basic base64(projectId:token)",
  ],
  langy_api_credential_invalid: [
    "The token did not resolve to a project — check it was copied whole and has not been revoked",
  ],
  langy_api_key_unowned: [
    "This key has no owning user, so there is no one for the turn to act as — mint a personal API key and use that instead",
  ],
  langy_api_key_no_langy_access: [
    "The user who owns this key cannot use Langy in this project — ask a workspace admin to grant Langy access, then retry",
  ],
  langy_api_actor_missing: [
    "The user who owns this key no longer exists — mint a new key under a current user",
  ],
  langy_api_request_invalid: [
    "Read the `issues` array in `meta` — it names the field that failed and why",
  ],
  langy_github_repo_not_accessible: [
    "Grant the LangWatch GitHub App access to that repository (Settings → Integrations → Configure), then retry",
  ],
  langy_worker_spawn_failed: [
    "The agent failed to start for this turn — nothing was lost, retry in a moment",
  ],
  langy_worker_stopped: [
    "The worker died mid-reply and the server already exhausted its recovery — the message is on record, retry manually",
  ],
  langy_agent_errored: [
    "The model call was rejected upstream — check meta/reasons for the provider's typed failure, then retry",
  ],
  langy_turn_timeout: [
    "Retry — or ask for a narrower slice: a shorter time range or a single trace",
  ],
  langy_worker_restarting: ["An update interrupted this reply — resend the message"],
  // UI-action channel errors (specs/langy/langy-ui-actions.feature). The
  // primary reader is the agent, which prints the envelope's `meta.tips` and
  // adapts its next step to them.
  langy_ui_turn_inactive: [
    "UI actions only work while your own turn is running; this command must be run by the agent during a conversation, not standalone",
  ],
  langy_ui_action_unknown: [
    "Run `langwatch ui actions` to list the actions the current page accepts",
  ],
  langy_ui_payload_invalid: [
    "Read meta.issues; each entry names the offending payload field and what was expected",
    "Run `langwatch ui actions` to see the action's payload schema",
  ],
  langy_ui_no_browser: [
    "The user has no page open that can run this action; tell them what you wanted to do, or use the equivalent API command instead",
  ],
  langy_ui_experiment_required: [
    "Pass --experiment <slug> so the backend knows which experiment to apply the action to; the slug is on the experiment context chip and in `langwatch experiment list`",
  ],
  langy_ui_timeout: [
    "The page may have applied part of the action; read the current state (for example `langwatch workbench get-state`) before retrying",
  ],
  langy_ui_handler_failed: [
    "Read meta.errorCode for the page's own failure reason, re-read the current state, and adjust the payload before retrying",
  ],
};

export function remediation(code: string): Remediation {
  const codeTips = tips[code];
  return codeTips === undefined ? {} : { tips: codeTips };
}
