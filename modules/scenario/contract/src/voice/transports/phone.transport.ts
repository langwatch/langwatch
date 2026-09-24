/** Twilio phone transport: vendor-specific module, one per headless run;
 * no browser paths; headless dial through createAgentAdapter.
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { AgentAdapter } from "@langwatch/scenario";
import { AgentRole, voice as scenarioVoice } from "@langwatch/scenario";

import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry.ts";

const logger = createLogger("langwatch:scenarios:voice:phone");

/**
 * Shown when a phone target's project has no Twilio credentials. Surfaced by
 * `createSerializedVoiceAgentAdapter` when the resolved credential is null, the
 * same way the ElevenLabs runner surfaces its own missing-key message.
 */
export const PHONE_NO_CREDENTIAL_MESSAGE =
  "No Twilio credentials in this project. Add them under Settings > Model Providers.";

/**
 * Shown on the browser-driven paths (availability, mint, record), which a phone
 * target has no meaning in: a phone call has no browser leg.
 */
export const PHONE_NO_BROWSER_CALL_MESSAGE =
  "Phone targets have no browser call. Run a scenario against the phone number instead.";

/** Prefix for a run whose Twilio connect or a-leg dial failed. */
export const PHONE_CONNECT_REJECTED_PREFIX = "Twilio rejected the call";

/**
 * The SDK's hard cap on an a-leg call duration, in seconds
 * (`MAX_CALL_DURATION_CAP_SECONDS`, unexported). `placeCall` throws above
 * it, so a higher `VOICE_CALL_MAX_SECONDS` must clamp to this; keep in step.
 */
export const TWILIO_MAX_CALL_DURATION_CAP_SECONDS = 300;

/**
 * How long the callee must stay silent before the SDK ends the callee's
 * turn (#8014: without this the turn only ended on hang-up or the 60s
 * ceiling). 0.8s, not the SDK's 0.6s default, since phone pauses run longer.
 */
export const PHONE_RESPONSE_TAIL_SILENCE_SECONDS = 0.8;

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

/** The narrow slice of `TwilioAgentAdapter` the runner drives. A fake standing
 *  in for it in a test implements just these three methods. */
export interface TwilioAdapterLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  placeCall(args: {
    to: string;
    attachStream?: "a-leg" | "b-leg";
    maxCallDurationSeconds?: number;
    /** Ask Twilio to record the call, so its whole-call audio can be played
     *  back later in the run drawer (#8014). Our own option name; the vendored
     *  SDK's published option is `record`, which
     *  {@link defaultTwilioAgentFactory} maps this to at the vendor boundary. A
     *  build without the recording patch ignores it. */
    shouldRecord?: boolean;
  }): Promise<void>;
}

/** Builds the SDK adapter; injectable so a test drives a fake instead of Twilio. */
export type TwilioAgentFactory = (options: {
  accountSid: string;
  authToken: string;
  /** The account's OWN Twilio number (the "from"), NOT the destination. */
  phoneNumber: string;
  publicBaseUrl?: string;
  /** The port the SDK's local media-stream server binds. See {@link resolveHttpPort}. */
  httpPort?: number;
  allowedCallees: readonly string[];
  /** The target under test is the agent; the synthetic caller is the user. */
  role: AgentRole;
}) => TwilioAdapterLike;

/** SDK's own adapter instance, not a wrapper: role validation and adapter
 * selection read instance identity and `role` property.
 */
const defaultTwilioAgentFactory: TwilioAgentFactory = (options) => {
  const sdk = scenarioVoice.twilioAgent(options);
  // Phone turn-taking: end the callee's turn after this much silence. The
  // SDK's inbound speech gate is left at its default (on), so silence between
  // the callee's utterances actually reaches the runtime as a gap — see
  // PHONE_RESPONSE_TAIL_SILENCE_SECONDS.
  sdk.responseTailSilence = PHONE_RESPONSE_TAIL_SILENCE_SECONDS;
  const originalPlaceCall = sdk.placeCall.bind(sdk);
  const adapter: TwilioAdapterLike = sdk;
  // Translate our `shouldRecord` to the SDK's published `record` option; this
  // one line is the only place the vendor option name appears.
  adapter.placeCall = ({ shouldRecord, ...rest }) =>
    originalPlaceCall({ ...rest, record: shouldRecord });
  return adapter;
};

/**
 * The env var name a resolved public base URL came from, so a failure log can
 * show at a glance whether the run used the voice worker's own hostname or
 * fell back to the app's.
 */
export type PublicBaseUrlSource = "VOICE_PUBLIC_BASE_URL" | "BASE_HOST";

/** Malformed VOICE_PUBLIC_BASE_URL or BASE_HOST: SDK has no validation so
 * bad URL reaches Twilio as error 11100; fail early with env var name.
 */
export class VoicePublicBaseUrlInvalidError extends Error {
  constructor(envVarName: PublicBaseUrlSource, value: string) {
    super(
      `${envVarName} is not a valid http(s) URL: "${value}". The Twilio ` +
        "media-stream URL is built from this value by a bare string " +
        "replace with no validation, so a malformed value reaches Twilio " +
        "as an invalid stream URL and the call fails with error 11100.",
    );
    this.name = "VoicePublicBaseUrlInvalidError";
  }
}

/**
 * Thrown when a phone run has no public media URL for the worker's listener.
 * Failing HERE turns a silent 120s Twilio timeout into an immediate, fixable
 * error. Plain {@link Error}: the remedy is an OPERATOR action, not the customer's.
 */
export class VoicePublicBaseUrlMissingError extends Error {
  constructor(source: PublicBaseUrlSource | "none", reason?: string) {
    // When the worker recorded WHY it minted no tunnel (its cloudflared tunnel
    // boot failed), name that real cause — otherwise the run error is a generic
    // "no public media URL" that hides a "spawn cloudflared ENOENT" behind it.
    const reasonSuffix = reason ? ` The worker's public URL tunnel failed to open: ${reason}` : "";
    super(
      `No public media URL for the outbound phone call (VOICE_PUBLIC_BASE_URL ` +
        `unset, resolved source: ${source}). The app's BASE_HOST runs no voice ` +
        `media listener, so Twilio would dial a URL nothing answers and the ` +
        `call would fail with error 31920 after a 120s timeout. Set ` +
        `VOICE_PUBLIC_BASE_URL, or ensure cloudflared is installed so the ` +
        `worker can mint a tunnel at boot.${reasonSuffix}`,
    );
    this.name = "VoicePublicBaseUrlMissingError";
  }
}

/** True when `value` parses as an absolute URL with an `http:`/`https:`
 *  protocol — the shape the SDK's naive scheme-swap assumes without checking. */
function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Validates/normalizes URL: accepts valid http(s) as-is, prepends scheme to
 * bare host (http for localhost, https for others), returns undefined if
 * unparseable so caller can throw VoicePublicBaseUrlInvalidError.
 */
function normalizeToHttpUrl(value: string): string | undefined {
  if (isValidHttpUrl(value)) return value;
  if (/\s/.test(value) || value.includes("://")) return undefined;

  const hostname = value.split(/[/:]/)[0] ?? "";
  const isLocalHost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
  const candidate = `${isLocalHost ? "http://" : "https://"}${value}`;
  return isValidHttpUrl(candidate) ? candidate : undefined;
}

/** App's public base URL for Twilio media stream: VOICE_PUBLIC_BASE_URL or
 * BASE_HOST; normalized via normalizeToHttpUrl, throws if unparseable.
 */
export function derivePublicBaseUrl(environment: PhoneTransportEnvironment): string | undefined {
  const resolved = derivePublicBaseUrlWithSource(environment);
  return resolved?.value;
}

/** Same resolution as {@link derivePublicBaseUrl}, but also reports which env
 *  var the value came from, so a caller can log it alongside the value. */
export function derivePublicBaseUrlWithSource(
  environment: PhoneTransportEnvironment,
): { value: string; source: PublicBaseUrlSource } | undefined {
  const fromWorker = environment.voicePublicBaseUrl?.trim();
  if (fromWorker) {
    const normalized = normalizeToHttpUrl(fromWorker);
    if (!normalized) {
      throw new VoicePublicBaseUrlInvalidError("VOICE_PUBLIC_BASE_URL", fromWorker);
    }
    return { value: normalized, source: "VOICE_PUBLIC_BASE_URL" };
  }

  const fromApp = environment.baseHost?.trim();
  if (fromApp) {
    const normalized = normalizeToHttpUrl(fromApp);
    if (!normalized) {
      throw new VoicePublicBaseUrlInvalidError("BASE_HOST", fromApp);
    }
    return { value: normalized, source: "BASE_HOST" };
  }

  return undefined;
}

/**
 * The port the SDK's local media-stream server binds: `VOICE_WS_PORT` when
 * valid, else `0` (OS-assigned). Lets an operator route a public origin to
 * the child in a single-worker deployment; slice 3's handoff supersedes it.
 */
export function resolveHttpPort(environment: PhoneTransportEnvironment): number {
  const raw = environment.voiceWsPort?.trim();
  if (!raw) return 0;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 0;
  return port;
}

/**
 * What the phone runner reads off its own process. The child's entrypoint reads
 * its environment once into this record; the parent filled it from scenario's config.
 */
export interface PhoneTransportEnvironment {
  readonly voicePublicBaseUrl?: string;
  readonly baseHost?: string;
  /** Why the worker has no public media URL, threaded down for the refusal. */
  readonly voicePublicBaseUrlUnavailableReason?: string;
  readonly voiceWsPort?: string;
}

/** The dependencies the phone runner is built from; a fake Twilio adapter stands in, in tests. */
export interface PhoneTransportDeps {
  twilioAgentFactory?: TwilioAgentFactory;
  environment: PhoneTransportEnvironment;
}

/** The Twilio branch of the credential union, or a thrown error. A credential
 *  built for another transport reaching this runner is a wiring bug. */
function twilioCredentialOf(credential: VoiceTransportCredential): {
  accountSid: string;
  authToken: string;
  fromNumber: string;
} {
  if (credential.kind !== "twilio") {
    throw new Error(`Phone transport received a ${credential.kind} credential`);
  }
  return {
    accountSid: credential.accountSid,
    authToken: credential.authToken,
    fromNumber: credential.fromNumber,
  };
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/** Wrap connect to also dial a-leg call; dial smuggled into override like
 * ElevenLabs timeout; connect/dial failure releases socket, surfaces with prefix.
 */
function withOutboundDial(
  adapter: TwilioAdapterLike,
  { to, maxCallDurationSeconds }: { to: string; maxCallDurationSeconds: number },
): TwilioAdapterLike {
  const originalConnect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    try {
      await originalConnect();
      await adapter.placeCall({
        to,
        attachStream: "a-leg",
        maxCallDurationSeconds,
        // Record the call so the whole-call audio is available for playback in
        // the run drawer once Twilio publishes the recording (#8014). Our
        // option; the factory maps it to the SDK's published `record`.
        shouldRecord: true,
      });
    } catch (error) {
      await adapter.disconnect().catch(() => {
        // Best-effort: the rejection below is what the caller sees.
      });
      throw new Error(`${PHONE_CONNECT_REJECTED_PREFIX}: ${reasonOf(error)}`);
    }
  };
  return adapter;
}

/**
 * Build the phone transport runner from its dependencies. `phoneTransport` is
 * the production instance; tests build their own with a fake adapter factory.
 */
export function createPhoneTransport(deps: PhoneTransportDeps): VoiceTransportRunner {
  const twilioAgentFactory = deps.twilioAgentFactory ?? defaultTwilioAgentFactory;

  return {
    missingKeyMessage: PHONE_NO_CREDENTIAL_MESSAGE,

    // A phone target has no browser call, so the browser-driven flow's
    // availability guard fails fast here; the headless dial never calls this.
    assertAvailable(): never {
      throw new VoicePhoneTransportUnavailableError();
    },

    mintSession(): Promise<never> {
      throw new VoicePhoneTransportUnavailableError();
    },

    getCallRecord(): Promise<never> {
      throw new VoicePhoneTransportUnavailableError();
    },

    async endCall(adapter): Promise<void> {
      // The SDK adapter's `disconnect()` hangs up the live a-leg call via REST
      // and closes the media socket; the cast is sealed in this one vendor
      // module rather than living at the child's call site.
      await (adapter as { disconnect?: () => Promise<void> }).disconnect?.();
    },

    createAgentAdapter({ agentId, credential, maxCallSeconds }): AgentAdapter {
      const twilio = twilioCredentialOf(credential);
      // The SDK caps an a-leg call at 300s and throws above it; a project whose
      // VOICE_CALL_MAX_SECONDS is higher is clamped down to the cap.
      const maxCallDurationSeconds = Math.min(maxCallSeconds, TWILIO_MAX_CALL_DURATION_CAP_SECONDS);
      const resolvedBaseUrl = derivePublicBaseUrlWithSource(deps.environment);
      // A phone call must route Twilio's media stream to VOICE_PUBLIC_BASE_URL,
      // the worker's own listener; BASE_HOST is the app's origin, which runs
      // none, and dialling it hands Twilio a dead URL (prod 31920 failure).
      if (!resolvedBaseUrl || resolvedBaseUrl.source === "BASE_HOST") {
        const source = resolvedBaseUrl?.source ?? "none";
        // The worker threads WHY its tunnel mint failed through this env var
        // (set at boot, forwarded by the child's environment), read from the
        // same env the base URL was resolved from so a test's injected env is
        // honored.
        const reason = deps.environment.voicePublicBaseUrlUnavailableReason?.trim();
        logger.error(
          { agentId, streamBaseUrlSource: source, reason },
          "no voice public base URL for outbound call; refusing to dial",
        );
        throw new VoicePublicBaseUrlMissingError(
          source,
          reason && reason.length > 0 ? reason : undefined,
        );
      }
      // Record only the URL origin in telemetry and logs — never the full
      // resolved URL, which may carry credentials or query parameters (CWE-532
      // sensitive-data exposure). The functional value handed to Twilio below
      // stays complete.
      const streamBaseUrlOrigin = new URL(resolvedBaseUrl.value).origin;
      // Log which base URL and env var this run's Twilio media stream is
      // routed to, so a later failure (e.g. error 11100) can be traced back to
      // what URL Twilio actually received.
      logger.info(
        {
          agentId,
          streamBaseUrl: streamBaseUrlOrigin,
          streamBaseUrlSource: resolvedBaseUrl.source,
        },
        "resolved Twilio media-stream base URL for outbound call",
      );
      const adapter = twilioAgentFactory({
        accountSid: twilio.accountSid,
        authToken: twilio.authToken,
        phoneNumber: twilio.fromNumber,
        publicBaseUrl: resolvedBaseUrl.value,
        httpPort: resolveHttpPort(deps.environment),
        // Only the dialled target is allowlisted, so the SDK's deny-by-default
        // a-leg guard passes for exactly this number and nothing else. There is
        // no user-facing allowlist; this guard is internal to the SDK.
        allowedCallees: [agentId],
        role: AgentRole.AGENT,
      });
      return withOutboundDial(adapter, {
        to: agentId,
        maxCallDurationSeconds,
      }) as unknown as AgentAdapter;
    },
  };
}
