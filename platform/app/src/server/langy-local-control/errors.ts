/**
 * The handled errors of local control (ADR-129).
 *
 * Every message is written so a customer could read it: the REST boundary
 * ships it in the response body, and the worker hands the text to the model as
 * the tool result. The words the panel shows live in the client presentation
 * registry, keyed by `code`.
 */

import { HandledError } from "@langwatch/handled-error";
import { remediation } from "~/server/app-layer/error-remediation";

/** No folder answers for this conversation, so a local call has nowhere to run. */
export class LangyLocalWorkspaceOfflineError extends HandledError {
  declare readonly code: "langy_local_workspace_offline";

  constructor({ conversationId }: { conversationId: string }) {
    super(
      "langy_local_workspace_offline",
      "No local folder is connected to this conversation. Share one with `npx langwatch@latest langy --share-control` in the folder you want Langy to work in.",
      {
        httpStatus: 503,
        // The machine that runs the command line is the customer's own.
        fault: "customer",
        meta: { conversationId },
        ...remediation("langy_local_workspace_offline"),
      },
    );
    this.name = "LangyLocalWorkspaceOfflineError";
  }
}

/**
 * A control request that cannot be approved: it belongs to another person, it
 * was already spent, or no such request exists. One code for all three, so the
 * answer never confirms that a request id someone guessed is real.
 */
export class LangyLocalRequestInvalidError extends HandledError {
  declare readonly code: "langy_local_request_invalid";

  constructor({ requestId }: { requestId?: string } = {}) {
    super(
      "langy_local_request_invalid",
      "That request to share a folder is not open for you. Ask Langy for the code change again to get a new one.",
      {
        httpStatus: 404,
        fault: "customer",
        meta: requestId ? { requestId } : {},
        ...remediation("langy_local_request_invalid"),
      },
    );
    this.name = "LangyLocalRequestInvalidError";
  }
}

/** The request was real, and its fifteen minutes are over. */
export class LangyLocalRequestExpiredError extends HandledError {
  declare readonly code: "langy_local_request_expired";

  constructor({ requestId }: { requestId: string }) {
    super(
      "langy_local_request_expired",
      "That request to share a folder expired. Ask Langy for the code change again to get a new one.",
      {
        httpStatus: 410,
        fault: "customer",
        meta: { requestId },
        ...remediation("langy_local_request_expired"),
      },
    );
    this.name = "LangyLocalRequestExpiredError";
  }
}

/** The permission card went unanswered for its whole budget. */
export class LangyLocalPermissionTimeoutError extends HandledError {
  declare readonly code: "langy_local_permission_timeout";

  constructor({ waitId, budgetMs }: { waitId: string; budgetMs: number }) {
    super(
      "langy_local_permission_timeout",
      "Nobody answered the permission card, so the command did not run.",
      {
        httpStatus: 408,
        fault: "customer",
        meta: { waitId, budgetMs },
        ...remediation("langy_local_permission_timeout"),
      },
    );
    this.name = "LangyLocalPermissionTimeoutError";
  }
}

/** The conversation's model is not on the provider's skip list. */
export class LangyLocalSkipModelNotAllowedError extends HandledError {
  declare readonly code: "langy_local_skip_model_not_allowed";

  constructor({ model, provider }: { model: string; provider: string }) {
    super(
      "langy_local_skip_model_not_allowed",
      "This model is not allowed to skip permission checks. Check the allowed models list in the provider settings.",
      {
        httpStatus: 403,
        fault: "customer",
        meta: { model, provider },
        ...remediation("langy_local_skip_model_not_allowed"),
      },
    );
    this.name = "LangyLocalSkipModelNotAllowedError";
  }
}

/** The card is no longer waiting: it was answered, it expired, or it was stopped. */
export class LangyWaitExpiredError extends HandledError {
  declare readonly code: "langy_wait_expired";

  constructor({ waitId }: { waitId: string }) {
    super(
      "langy_wait_expired",
      "This card is no longer waiting for an answer. Send Langy a message with your answer instead.",
      {
        httpStatus: 410,
        fault: "customer",
        meta: { waitId },
        ...remediation("langy_wait_expired"),
      },
    );
    this.name = "LangyWaitExpiredError";
  }
}
