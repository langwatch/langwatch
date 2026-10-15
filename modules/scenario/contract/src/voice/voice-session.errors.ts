import { VOICE_AGENTS_DISABLED_MESSAGE } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";

/** The project has no key for this transport, so no session can be minted. */
export class VoiceKeyMissingError extends HandledError {
  declare readonly code: "voice_key_missing";
  constructor(message: string) {
    super("voice_key_missing", message, { httpStatus: 400 });
    this.name = "VoiceKeyMissingError";
  }
}

/** A run cannot be created for an unsaved agent without a name to save it
 *  under. The panel collects one and retries. */
export class VoiceNameRequiredError extends HandledError {
  declare readonly code: "voice_name_required";
  constructor() {
    super("voice_name_required", "A name is required to save the agent", {
      httpStatus: 400,
    });
    this.name = "VoiceNameRequiredError";
  }
}

/** The provider refused the mint (bad agent id, network, API error). */
export class VoiceMintFailedError extends HandledError {
  declare readonly code: "voice_mint_failed";
  constructor(message: string) {
    super("voice_mint_failed", message, { httpStatus: 400 });
    this.name = "VoiceMintFailedError";
  }
}

/**
 * The finished conversation ran against a different vendor agent than the
 * session token was minted for. Reported without writing anything, so one
 * project cannot pull another's conversation into its runs.
 */
export class VoiceConversationMismatchError extends HandledError {
  declare readonly code: "voice_conversation_mismatch";
  constructor() {
    super(
      "voice_conversation_mismatch",
      "This conversation does not belong to the minted session",
      { httpStatus: 400 },
    );
    this.name = "VoiceConversationMismatchError";
  }
}

/**
 * The mint request named an agent row that does not exist in this project, or
 * exists but is not a voice agent. Minting never trusts a client-supplied
 * vendor agent id (AC13/AC29) — the row is the only source of it.
 */
export class VoiceAgentRowNotFoundError extends HandledError {
  declare readonly code: "agent_not_found";
  constructor() {
    super("agent_not_found", "The voice agent was not found in this project", {
      httpStatus: 404,
    });
    this.name = "VoiceAgentRowNotFoundError";
  }
}

/**
 * A "Call it myself" finish named a scenario that no longer resolves to a
 * set: archived, removed, or another project's. Nothing is written rather
 * than silently downgrading to an unjudged drawer call (#8019).
 */
export class VoiceScenarioNotFoundError extends HandledError {
  declare readonly code: "scenario_not_found";
  constructor() {
    super("scenario_not_found", "The scenario was not found in this project", {
      httpStatus: 404,
    });
    this.name = "VoiceScenarioNotFoundError";
  }
}

/** The session token failed verification, or was minted for another project. */
export class VoiceSessionInvalidError extends HandledError {
  declare readonly code: "voice_session_invalid";
  constructor() {
    super("voice_session_invalid", "The session is invalid or has expired", {
      httpStatus: 400,
    });
    this.name = "VoiceSessionInvalidError";
  }
}

/** No live auth session behind a voice request. */
export class VoiceUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";
  constructor() {
    super("unauthorized", "Sign in to continue", { httpStatus: 401 });
    this.name = "VoiceUnauthenticatedError";
  }
}

/**
 * The whole "Talk to it" door is behind the product flag: a project without it
 * turned on gets the same 404 the drawer and the run dialog render for, not a
 * 403 that would leak that the door exists at all (AC29).
 */
export class VoiceAgentsGateDisabledError extends HandledError {
  declare readonly code: "voice_agents_disabled";
  constructor() {
    super("voice_agents_disabled", VOICE_AGENTS_DISABLED_MESSAGE, {
      httpStatus: 404,
    });
    this.name = "VoiceAgentsGateDisabledError";
  }
}

/**
 * The audio proxy found no run for this conversation, or the provider had
 * nothing to stream back. Kept 404, not 400, matching the flag-off and
 * row-not-found responses on the same door.
 */
export class VoiceRecordingUnavailableError extends HandledError {
  declare readonly code: "voice_recording_unavailable";
  constructor() {
    super("voice_recording_unavailable", "The call recording is not available", {
      httpStatus: 404,
    });
    this.name = "VoiceRecordingUnavailableError";
  }
}

/** The audio proxy has no provider key to fetch the recording with. */
export class VoiceRecordingKeyMissingError extends HandledError {
  declare readonly code: "voice_recording_key_missing";
  constructor() {
    super("voice_recording_key_missing", "The call recording is not available", {
      httpStatus: 404,
    });
    this.name = "VoiceRecordingKeyMissingError";
  }
}

/**
 * Shown on the browser-driven paths (availability, mint, record), which a phone
 * target has no meaning in: a phone call has no browser leg.
 */
export const PHONE_NO_BROWSER_CALL_MESSAGE =
  "Phone targets have no browser call. Run a scenario against the phone number instead.";

/**
 * A phone target was exercised on a path it has no meaning on (a browser
 * mint, record, or availability guard). One code, so the failure reads the
 * same everywhere; extends the same HandledError base as voice-session.
 */
export class VoicePhoneTransportUnavailableError extends HandledError {
  declare readonly code: "voice_phone_transport_unavailable";
  constructor(message: string = PHONE_NO_BROWSER_CALL_MESSAGE) {
    super("voice_phone_transport_unavailable", message, { httpStatus: 400 });
    this.name = "VoicePhoneTransportUnavailableError";
  }
}
