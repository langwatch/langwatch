import { HandledError } from "@langwatch/handled-error";

import { remediation, remediationFor } from "../../error-remediation";

/**
 * UI-action channel errors (specs/langy/langy-ui-actions.feature).
 *
 * Every refusal on the dispatch path is a handled error with a stable code,
 * because the primary reader is the AGENT: the CLI prints the envelope to
 * stderr and the model adapts its next step to the `code`. Only
 * `langy_ui_timeout` and `langy_ui_handler_failed` also reach a human (as a
 * toast on the page that tried to execute), so only those two carry
 * presentation copy beyond the registry defaults.
 */

/** The conversation has no turn in flight, so no page is listening (HTTP 409). */
export class LangyUiTurnInactiveError extends HandledError {
  declare readonly code: "langy_ui_turn_inactive";
  constructor() {
    super(
      "langy_ui_turn_inactive",
      "No agent turn is active for this conversation, so there is no live page to drive.",
      {
        httpStatus: 409,
        ...remediation("langy_ui_turn_inactive"),
      },
    );
    this.name = "LangyUiTurnInactiveError";
  }
}

/** `kind` names no entry in any page's action manifest (HTTP 400). */
export class LangyUiActionUnknownError extends HandledError {
  declare readonly code: "langy_ui_action_unknown";
  constructor(kind: string) {
    super("langy_ui_action_unknown", `Unknown UI action "${kind}".`, {
      httpStatus: 400,
      fault: "customer",
      meta: { kind },
      ...remediation("langy_ui_action_unknown"),
    });
    this.name = "LangyUiActionUnknownError";
  }
}

/** The payload failed the action's schema (HTTP 400). `meta.issues` names the fields. */
export class LangyUiPayloadInvalidError extends HandledError {
  declare readonly code: "langy_ui_payload_invalid";
  constructor(kind: string, issues: readonly unknown[]) {
    super(
      "langy_ui_payload_invalid",
      `The payload for "${kind}" does not match the action's schema.`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { kind, issues: issues.slice(0, 10) },
        ...remediation("langy_ui_payload_invalid"),
      },
    );
    this.name = "LangyUiPayloadInvalidError";
  }
}

/**
 * Nothing claimed the action within the claim window and the action has no
 * backend fallback (HTTP 409). Phase 3 turns most of these into a transparent
 * backend execution; this refusal remains for kinds only a live page can run.
 */
export class LangyUiNoBrowserError extends HandledError {
  declare readonly code: "langy_ui_no_browser";
  constructor(kind: string) {
    super("langy_ui_no_browser", `No open page claimed "${kind}" in time.`, {
      httpStatus: 409,
      meta: { kind },
      ...remediation("langy_ui_no_browser"),
    });
    this.name = "LangyUiNoBrowserError";
  }
}

/**
 * A page claimed the action and never reported a result inside the action's
 * execute budget (HTTP 504). The page may still have half-applied it, so the
 * caller must re-read state before retrying rather than firing again blind.
 */
export class LangyUiTimeoutError extends HandledError {
  declare readonly code: "langy_ui_timeout";
  constructor(kind: string) {
    super(
      "langy_ui_timeout",
      `The page claimed "${kind}" but did not finish inside the action's time budget.`,
      {
        httpStatus: 504,
        fault: "platform",
        meta: { kind },
        ...remediation("langy_ui_timeout"),
      },
    );
    this.name = "LangyUiTimeoutError";
  }
}

/**
 * The action must run on the backend (no page answered) and the dispatch named
 * no experiment to run it against (HTTP 400). The browser path never needs
 * this: the open page IS the experiment. The CLI passes `--experiment <slug>`.
 */
export class LangyUiExperimentRequiredError extends HandledError {
  declare readonly code: "langy_ui_experiment_required";
  constructor(kind: string) {
    super(
      "langy_ui_experiment_required",
      `No open page answered, and running "${kind}" on the backend needs the experiment named.`,
      {
        httpStatus: 400,
        fault: "customer",
        meta: { kind },
        ...remediation("langy_ui_experiment_required"),
      },
    );
    this.name = "LangyUiExperimentRequiredError";
  }
}

/**
 * The generic code the browser reports when a handler threw something that
 * named no code of its own.
 */
const UNTYPED_HANDLER_FAILURE = "langy_ui_handler_failed";

/**
 * The action ran on the page or on the backend and failed there (HTTP 502).
 *
 * The fault follows `errorCode`: a code names the handler's own typed refusal
 * (a transform's `target_not_found`, an experiment with no saved state), which
 * the agent asked for and can act on, so the caller is at fault. No code, or
 * the generic one the browser sends for a throw that named none, is a failure
 * we cannot explain, so it stays a platform fault and keeps alerting. The
 * status stays 502 either way: the page is the upstream that did not carry the
 * action out, and `fault` is the axis log level and alerts read.
 */
export class LangyUiHandlerFailedError extends HandledError {
  declare readonly code: "langy_ui_handler_failed";
  constructor(kind: string, errorCode?: string) {
    super(
      "langy_ui_handler_failed",
      `The page could not carry out "${kind}".`,
      {
        httpStatus: 502,
        fault:
          errorCode && errorCode !== UNTYPED_HANDLER_FAILURE
            ? "customer"
            : "platform",
        meta: { kind, ...(errorCode ? { errorCode } : {}) },
        // The page's own code first when it has advice of its own: the generic
        // tip only says to read `meta.errorCode`, which is a name, not a next
        // step.
        ...{
          ...remediation("langy_ui_handler_failed"),
          ...remediationFor(errorCode),
        },
      },
    );
    this.name = "LangyUiHandlerFailedError";
  }
}
