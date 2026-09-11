/**
 * The phone (Twilio) transport.
 *
 * This is the ONE module in the codebase that names Twilio or touches the
 * Twilio SDK adapter. Everything above it speaks of a `VoiceTransport` and a
 * `VoiceTransportRunner`; the vendor coupling (the SDK `TwilioAgentAdapter`,
 * the a-leg outbound dial, the connect wrapping) is sealed in here, mirroring
 * {@link elevenLabsConvaiTransport}.
 *
 * A phone target is dialled from a headless scenario run in the pool child,
 * through {@link createAgentAdapter}: `connect()` starts the SDK's own local
 * media-stream server, then the wrapped connect originates the a-leg call to
 * the target number.
 *
 * There is no browser call over phone, so `assertAvailable`, `mintSession` and
 * `fetchCallRecord` throw {@link VoicePhoneTransportUnavailableError}. Those are
 * only ever reached through the browser-driven `voice-session.service.ts` flow,
 * which a phone target has no meaning in (a phone call has no browser leg and
 * the 1.7.0 SDK exposes no Twilio call-record REST surface). The headless dial
 * does NOT go through them.
 */

import { randomBytes } from "node:crypto";
import type { Socket } from "node:net";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { AgentAdapter } from "@langwatch/scenario";
import { AgentRole, voice as scenarioVoice } from "@langwatch/scenario";
import {
  raceAgainstUpgradeRefusal,
  requestNonceRegistration,
} from "../voice-nonce-handoff";
import {
  createVoiceSocketReceiver,
  type VoiceSocketReceiver,
} from "../voice-socket-handoff";
import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry";

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
 * The SDK's hard cap on an a-leg call's duration, in seconds
 * (`MAX_CALL_DURATION_CAP_SECONDS` in the 1.7.0-dev scenario SDK). The SDK does
 * NOT export the constant, and `placeCall` throws when `maxCallDurationSeconds`
 * exceeds it, so a project whose `VOICE_CALL_MAX_SECONDS` is higher must be
 * clamped to this before the dial. Mirrored here with this comment; keep it in
 * step with the SDK on a version bump.
 */
export const TWILIO_MAX_CALL_DURATION_CAP_SECONDS = 300;

/**
 * A phone target was exercised on a path it has no meaning on (a browser mint
 * or record, or an availability guard). One code, so the failure reads the same
 * wherever it surfaces. Extends the same {@link HandledError} base the
 * voice-session errors use, with the base's default customer fault.
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
    /** The Twilio media-stream nonce the caller (this transport) has already
     *  registered with the parent worker's listener — see
     *  {@link withOutboundDial}. Passed straight through to the SDK, which
     *  mints its own when omitted (every non-phone-transport caller of the
     *  SDK, e.g. its own examples/tests). */
    streamNonce?: string;
  }): Promise<void>;
  /**
   * Feeds a raw socket the SDK's own upgrade never saw — one the PARENT
   * worker accepted and handed off over IPC ({@link handOffVoiceSocket}) —
   * into the SDK's local media-stream server so it completes the WebSocket
   * handshake and starts reading Twilio's audio frames. Optional: a fake
   * adapter in a test need not implement it unless the test exercises the
   * handoff wiring itself.
   */
  receiveExternalMediaSocket?(params: {
    req: {
      method: string;
      url: string;
      headers: Record<string, string | string[] | undefined>;
    };
    socket: Socket;
    head: Buffer;
  }): void;
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

/** The real SDK adapter's `placeCall` shape. Its recording option is `record`
 *  — the SDK's published name, which must not change; our interface exposes it
 *  as `shouldRecord` and this factory translates at the vendor boundary. */
type SdkTwilioAdapter = Omit<TwilioAdapterLike, "placeCall"> & {
  placeCall(args: {
    to: string;
    attachStream?: "a-leg" | "b-leg";
    maxCallDurationSeconds?: number;
    record?: boolean;
    streamNonce?: string;
  }): Promise<void>;
};

/**
 * Must return the SDK's own adapter instance, never a fresh wrapper object.
 * `withOutboundDial` below mutates a method on the instance in place for the
 * same reason: the run's role validation and the executor's voice-adapter
 * selection (`pickVoiceAdapters` / `startVoiceAdapters`) both read off THIS
 * instance's identity and its `role` property. A wrapper that copies only
 * connect/disconnect/placeCall onto a plain object silently strips `role` and
 * everything else the SDK adapter carries.
 */
const defaultTwilioAgentFactory: TwilioAgentFactory = (options) => {
  const sdk = scenarioVoice.twilioAgent(options) as unknown as SdkTwilioAdapter;
  const originalPlaceCall = sdk.placeCall.bind(sdk);
  const adapter = sdk as unknown as TwilioAdapterLike;
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

/**
 * Thrown when a present `VOICE_PUBLIC_BASE_URL` or `BASE_HOST` value can't be
 * turned into an absolute `http:`/`https:` URL, even after normalization (see
 * {@link normalizeToHttpUrl}). The vendored SDK builds Twilio's media-stream
 * URL by a bare string replace (`publicBaseUrl.replace(/^https:/, "wss:")...`)
 * with no validation of its own, so a malformed base URL is not rejected here
 * — it is embedded as-is into the TwiML `<Stream url>` Twilio is told to
 * open, and only surfaces later as Twilio error 11100 ("Invalid URL format")
 * with a zero-duration call. Failing loudly at dial time, naming the
 * offending env var and value, is far better than that 120-second silent
 * timeout.
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

/**
 * Accepts an already-valid `http:`/`https:` URL unchanged. Otherwise, if
 * `value` looks like a bare host (optionally with a port and/or path, no
 * scheme, no spaces) — the shape `BASE_HOST` legitimately takes in CI
 * (`BASE_HOST: "localhost:3000"` in `langwatch-app-ci.yml`) and in local dev
 * — prepends a scheme and re-validates: `http://` for `localhost`,
 * `127.0.0.1`, or a `.localhost` hostname, `https://` for everything else.
 * Returns `undefined` when neither shape parses as an absolute http(s) URL,
 * so the caller can throw {@link VoicePublicBaseUrlInvalidError} naming the
 * original, unmodified value.
 */
function normalizeToHttpUrl(value: string): string | undefined {
  if (isValidHttpUrl(value)) return value;
  if (/\s/.test(value) || value.includes("://")) return undefined;

  const hostname = value.split(/[/:]/)[0] ?? "";
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost");
  const candidate = `${isLocalHost ? "http://" : "https://"}${value}`;
  return isValidHttpUrl(candidate) ? candidate : undefined;
}

/**
 * The app's public HTTPS base URL the SDK routes Twilio's media stream to.
 * `VOICE_PUBLIC_BASE_URL` when set (the voice worker's own hostname), otherwise
 * the app's own `BASE_HOST`. Read from `process.env` directly, the same way
 * `voice-limits` reads its knobs, so the pool child and the worker both reach
 * it without threading the config object.
 *
 * A present value is normalized via {@link normalizeToHttpUrl} — a scheme-less
 * host like `localhost:3000` or `voice.example.com` is accepted and given a
 * scheme, not rejected. Only a value that still doesn't parse as an absolute
 * http(s) URL after that throws {@link VoicePublicBaseUrlInvalidError}: see
 * that error's doc comment for why. Neither variable set still resolves to
 * `undefined`, unchanged from before.
 */
export function resolvePublicBaseUrl(
  processEnv: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const resolved = resolvePublicBaseUrlWithSource(processEnv);
  return resolved?.value;
}

/** Same resolution as {@link resolvePublicBaseUrl}, but also reports which env
 *  var the value came from, so a caller can log it alongside the value. */
export function resolvePublicBaseUrlWithSource(
  processEnv: NodeJS.ProcessEnv = process.env,
): { value: string; source: PublicBaseUrlSource } | undefined {
  const fromWorker = processEnv.VOICE_PUBLIC_BASE_URL?.trim();
  if (fromWorker) {
    const normalized = normalizeToHttpUrl(fromWorker);
    if (!normalized) {
      throw new VoicePublicBaseUrlInvalidError(
        "VOICE_PUBLIC_BASE_URL",
        fromWorker,
      );
    }
    return { value: normalized, source: "VOICE_PUBLIC_BASE_URL" };
  }

  const fromApp = processEnv.BASE_HOST?.trim();
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
 * The port the SDK's local media-stream server binds. `VOICE_WS_PORT` when it
 * is a valid port number, otherwise `0` (OS-assigned), the SDK's own default.
 * A fixed port lets an operator route a public HTTPS origin to the child in a
 * single-worker deployment; slice 3's listener handoff supersedes it.
 */
export function resolveHttpPort(
  processEnv: NodeJS.ProcessEnv = process.env,
): number {
  const raw = processEnv.VOICE_WS_PORT?.trim();
  if (!raw) return 0;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 0;
  return port;
}

/**
 * Mints a per-call Twilio media-stream nonce and hands it to the parent
 * worker to register before the dial. Injectable so a test drives a fake
 * parent instead of the real IPC channel; defaults to
 * {@link requestNonceRegistration} against the real `process`.
 */
export type NonceRegistrar = (params: { nonce: string }) => Promise<void>;

/** 16 bytes of CSPRNG entropy, hex-encoded — mirrors the SDK's own
 *  `STREAM_NONCE_BYTES`/`mintStreamNonce` (twilio-shared.ts): the platform
 *  mints independently rather than importing the SDK's mint function, since
 *  the nonce is opaque to the SDK once injected via `streamNonce`. */
const STREAM_NONCE_BYTES = 16;

/** Mint a fresh per-call Twilio media-stream nonce. */
function mintPhoneStreamNonce(): string {
  return randomBytes(STREAM_NONCE_BYTES).toString("hex");
}

/** The dependencies the phone runner is built from. Injected in tests so a fake
 *  Twilio adapter and a controlled env stand in for the real SDK and host. */
export interface PhoneTransportDeps {
  twilioAgentFactory?: TwilioAgentFactory;
  processEnv?: NodeJS.ProcessEnv;
  /** Overrides how the nonce is registered with the parent; defaults to the
   *  real IPC round-trip. Tests inject a fake to control ordering/failure. */
  registerNonce?: NonceRegistrar;
  /** Overrides nonce minting so a test can assert on a known value. */
  mintNonce?: () => string;
  /** Overrides the upgrade-refusal race; defaults to the real
   *  {@link raceAgainstUpgradeRefusal} listening on `process`. Tests inject a
   *  fake to simulate a refusal notice arriving mid-dial. */
  raceUpgradeRefusal?: <T>(promise: Promise<T>) => Promise<T>;
  /** Overrides the child-side socket receiver; defaults to the real
   *  {@link createVoiceSocketReceiver} listening on `process`. Tests inject a
   *  fake to drive the handoff without a real IPC channel. */
  socketReceiver?: VoiceSocketReceiver;
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

/**
 * Wrap `connect()` so connecting also originates the a-leg call to the target.
 * `connect()` alone never dials: `placeCall`'s `to` is not a constructor option,
 * so the dial is smuggled into the connect override exactly the way the
 * ElevenLabs runner smuggles its timeout handling. A connect or dial failure
 * releases the socket best-effort and surfaces with a clear prefix, so a
 * refused destination (the SDK's deny-by-default a-leg guard) or an unreachable
 * edge reads as the run's error rather than a raw socket throw.
 *
 * Before dialling, this process (the scenario child) mints the Twilio stream
 * nonce ITSELF and registers it with the parent worker over IPC
 * (`registerNonce`, {@link requestNonceRegistration} by default) — the parent
 * owns the public media listener Twilio actually connects back to
 * (`voice-ws-listener.ts`), so the nonce must exist in its registry BEFORE
 * Twilio can possibly dial back. `placeCall` is only ever called once that
 * registration is acknowledged; a timeout, a parent-reported failure, or the
 * absence of an IPC channel all fail the dial loudly instead of originating a
 * call whose media socket the listener could never authenticate.
 */
function withOutboundDial(
  adapter: TwilioAdapterLike,
  {
    to,
    maxCallDurationSeconds,
    registerNonce,
    mintNonce,
    raceUpgradeRefusal,
  }: {
    to: string;
    maxCallDurationSeconds: number;
    registerNonce: NonceRegistrar;
    mintNonce: () => string;
    raceUpgradeRefusal: <T>(promise: Promise<T>) => Promise<T>;
  },
): TwilioAdapterLike {
  const originalConnect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    try {
      await originalConnect();
      const streamNonce = mintNonce();
      // Wait for the parent's ack BEFORE placeCall: dialling first would race
      // Twilio's dial-back against the parent's registration, and the
      // listener refuses any upgrade whose nonce it does not yet know.
      await registerNonce({ nonce: streamNonce });
      // Racing against a possible refusal notice: if the listener later
      // refuses this exact nonce (only possible once it has expired — a
      // freshly registered nonce cannot be unknown), fail fast with that
      // real cause instead of silently burning placeCall's full connect-wait
      // timeout and reporting a misleading generic failure.
      await raceUpgradeRefusal(
        adapter.placeCall({
          to,
          attachStream: "a-leg",
          maxCallDurationSeconds,
          // Record the call so the whole-call audio is available for playback
          // in the run drawer once Twilio publishes the recording (#8014).
          // Our option; the factory maps it to the SDK's published `record`.
          shouldRecord: true,
          streamNonce,
        }),
      );
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
export function createPhoneTransport(
  deps: PhoneTransportDeps = {},
): VoiceTransportRunner {
  const twilioAgentFactory =
    deps.twilioAgentFactory ?? defaultTwilioAgentFactory;
  const registerNonce: NonceRegistrar =
    deps.registerNonce ?? ((params) => requestNonceRegistration(params));
  const mintNonce = deps.mintNonce ?? mintPhoneStreamNonce;
  const raceUpgradeRefusal =
    deps.raceUpgradeRefusal ??
    (<T>(promise: Promise<T>): Promise<T> =>
      raceAgainstUpgradeRefusal(promise));
  const socketReceiver = deps.socketReceiver ?? createVoiceSocketReceiver();

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

    fetchCallRecord(): Promise<never> {
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
      const maxCallDurationSeconds = Math.min(
        maxCallSeconds,
        TWILIO_MAX_CALL_DURATION_CAP_SECONDS,
      );
      const resolvedBaseUrl = resolvePublicBaseUrlWithSource(deps.processEnv);
      // Log which base URL and env var this run's Twilio media stream is
      // routed to. There is no span available at this point to stamp
      // `voice.twilio.stream_base_url` on directly, so a failed call (error
      // 11100, zero duration) can still be traced back to what URL Twilio
      // actually received via this log line.
      if (resolvedBaseUrl) {
        logger.info(
          {
            agentId,
            streamBaseUrl: resolvedBaseUrl.value,
            streamBaseUrlSource: resolvedBaseUrl.source,
          },
          "resolved Twilio media-stream base URL for outbound call",
        );
      }
      const adapter = twilioAgentFactory({
        accountSid: twilio.accountSid,
        authToken: twilio.authToken,
        phoneNumber: twilio.fromNumber,
        publicBaseUrl: resolvedBaseUrl?.value,
        httpPort: resolveHttpPort(deps.processEnv),
        // Only the dialled target is allowlisted, so the SDK's deny-by-default
        // a-leg guard passes for exactly this number and nothing else. There is
        // no user-facing allowlist; this guard is internal to the SDK.
        allowedCallees: [agentId],
        role: AgentRole.AGENT,
      });
      // The other half of the nonce-registration handshake: once Twilio dials
      // back, the PARENT worker's listener accepts the upgrade (it owns the
      // public port) and hands the raw socket to this child over IPC
      // (`handOffVoiceSocket`/`voice-ws-listener.ts`). Without this wiring the
      // child would register the nonce and dial correctly, but the arriving
      // socket would have nowhere to go and the call would still never
      // connect. One scenario child handles exactly one call, so the receiver
      // lives for the process's lifetime — no unsubscribe needed.
      socketReceiver.onVoiceSocket(({ message, socket, head }) => {
        adapter.receiveExternalMediaSocket?.({
          req: {
            method: message.method,
            url: message.url,
            headers: message.headers,
          },
          socket,
          head,
        });
      });
      return withOutboundDial(adapter, {
        to: agentId,
        maxCallDurationSeconds,
        registerNonce,
        mintNonce,
        raceUpgradeRefusal,
      }) as unknown as AgentAdapter;
    },
  };
}

export const phoneTransport: VoiceTransportRunner = createPhoneTransport();
