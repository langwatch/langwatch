/**
 * The phone (Twilio) transport.
 *
 * This is the ONE module in the codebase that names Twilio or touches the
 * Twilio SDK adapter. Everything above it speaks of a `VoiceTransport` and a
 * `VoiceTransportRunner`; the vendor coupling (the SDK `TwilioAgentAdapter`,
 * the a-leg origination, the Recording REST read, the customer-facing failure
 * string) is sealed in here, mirroring {@link elevenLabsConvaiTransport}.
 *
 * The runner is INERT by default and fails closed: without the Twilio operator
 * environment (`VOICE_PUBLIC_BASE_URL` and the `TWILIO_*` credentials) every run
 * path throws {@link VoicePhoneTransportUnavailableError}, so a deployment that
 * has not configured Twilio sees no behaviour change. The worker that actually
 * dials a phone target is a later slice (langwatch/langwatch#8014); this module
 * ships the runner it will drive.
 *
 * There is no browser call over phone, so `assertAvailable`/`mintSession` throw:
 * a "Talk to it" mint has nothing to mint.
 */

import { HandledError } from "@langwatch/handled-error";
import type { AgentAdapter } from "@langwatch/scenario";
import * as ScenarioRunner from "@langwatch/scenario";
import { VOICE_PHONE_MAX_CALL_DURATION_SECONDS } from "~/server/agents/voice/voice-phone-config";
import type { CallRecord } from "../call-record";
import { VOICE_HTTP_TIMEOUT_MS } from "../voice-limits";
import type { VoiceTransportRunner } from "../voice-transport.registry";

/** Shown on any attempt to run a phone target while Twilio is not configured. */
export const PHONE_TRANSPORT_UNAVAILABLE_MESSAGE =
  "Phone targets need Twilio configured on this deployment (VOICE_PUBLIC_BASE_URL and the TWILIO_* credentials). Track langwatch/langwatch#8014.";

/** Shown when a phone target is dialled at a number the project has not
 *  allowlisted. Deny-by-default: an empty allowlist refuses every destination. */
export const PHONE_CALLEE_NOT_ALLOWED_PREFIX =
  "This number is not in the project's phone allowlist";

/**
 * A phone target could not be run: Twilio is not configured, or the transport
 * has no meaning here (no browser call). One code, so the failure reads the same
 * wherever it surfaces. Extends the same {@link HandledError} base the
 * voice-session errors use, with the base's default customer fault.
 */
export class VoicePhoneTransportUnavailableError extends HandledError {
  declare readonly code: "voice_phone_transport_unavailable";
  constructor(message: string = PHONE_TRANSPORT_UNAVAILABLE_MESSAGE) {
    super("voice_phone_transport_unavailable", message, { httpStatus: 400 });
    this.name = "VoicePhoneTransportUnavailableError";
  }
}

/** The operator env a phone run needs. Resolved once, fail-closed: any missing
 *  value collapses the whole thing to `null` so the run reports "unavailable"
 *  rather than reaching Twilio with a half-formed credential. */
export interface TwilioEnv {
  accountSid: string;
  authToken: string;
  /** The Twilio-owned origination number (E.164) the call dials FROM. */
  fromNumber: string;
  /** HTTPS URL routing to this deployment, handed to Twilio for the media WS. */
  publicBaseUrl: string;
}

/** Read the Twilio operator env, fail-closed. `null` when any part is unset. */
export function resolveTwilioEnv(
  env: NodeJS.ProcessEnv = process.env,
): TwilioEnv | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = env.TWILIO_PHONE_NUMBER?.trim();
  const publicBaseUrl = env.VOICE_PUBLIC_BASE_URL?.trim();
  if (!accountSid || !authToken || !fromNumber || !publicBaseUrl) return null;
  return { accountSid, authToken, fromNumber, publicBaseUrl };
}

/** The Twilio Media Streams SDK adapter the runner drives. Narrowed to the
 *  surface this module uses so a fake adapter can stand in for it in a test. */
export interface TwilioAdapterLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  placeCall(args: {
    to: string;
    attachStream?: "a-leg" | "b-leg";
    maxCallDurationSeconds?: number;
  }): Promise<void>;
  responseTimeout?: number;
}

/** Builds the SDK adapter; injectable so a test drives a fake instead of Twilio. */
export type TwilioAgentFactory = (options: {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  publicBaseUrl: string;
  allowedCallees: readonly string[];
}) => TwilioAdapterLike;

const defaultTwilioAgentFactory: TwilioAgentFactory = (options) =>
  ScenarioRunner.voice.twilioAgent(options) as unknown as TwilioAdapterLike;

/** Basic-auth header for the Twilio REST API. Never logged. */
function twilioAuthHeader({ accountSid, authToken }: TwilioEnv): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

interface TwilioRecording {
  sid?: string;
  status?: string;
  duration?: string;
  start_time?: string;
  date_created?: string;
}

interface TwilioRecordingsResponse {
  recordings?: TwilioRecording[];
}

/**
 * The dependencies the phone runner is built from. Split out so a unit test can
 * inject a fake Twilio adapter factory, a controlled env and a mock `fetch`
 * without a live Twilio account.
 */
export interface PhoneTransportDeps {
  twilioAgentFactory?: TwilioAgentFactory;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

/**
 * Wrap the adapter's `connect()` so connecting also originates the a-leg call to
 * the target number, mirroring how the ElevenLabs runner wraps `connect()`. The
 * project's deny-by-default allowlist is enforced here before the dial, so a
 * number an operator has not opted into never reaches Twilio.
 */
function withOutboundDial(
  adapter: TwilioAdapterLike,
  {
    to,
    allowedCallees,
    maxCallDurationSeconds,
  }: {
    to: string;
    allowedCallees: readonly string[];
    maxCallDurationSeconds: number;
  },
): TwilioAdapterLike {
  const originalConnect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    if (!allowedCallees.includes(to)) {
      throw new VoicePhoneTransportUnavailableError(
        `${PHONE_CALLEE_NOT_ALLOWED_PREFIX}: ${to}`,
      );
    }
    await originalConnect();
    await adapter.placeCall({
      to,
      attachStream: "a-leg",
      maxCallDurationSeconds,
    });
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
  const twilioAgentFactory = deps.twilioAgentFactory ?? defaultTwilioAgentFactory;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readEnv = () => resolveTwilioEnv(deps.env ?? process.env);

  return {
    missingKeyMessage: PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,

    // Phone has no browser "Talk to it" call: the run is dialled from the
    // worker, so a browser mint has nothing to mint.
    assertAvailable(): never {
      throw new VoicePhoneTransportUnavailableError();
    },

    mintSession(): Promise<never> {
      throw new VoicePhoneTransportUnavailableError();
    },

    createAgentAdapter({ agentId, maxCallSeconds, phoneConfig }): AgentAdapter {
      const env = readEnv();
      if (!env) throw new VoicePhoneTransportUnavailableError();
      // Deny-by-default: an absent phoneConfig allows no destination at all.
      const allowedCallees = phoneConfig?.allowedCallees ?? [];
      const maxCallDurationSeconds = Math.min(
        maxCallSeconds,
        phoneConfig?.maxCallDurationSeconds ?? maxCallSeconds,
        VOICE_PHONE_MAX_CALL_DURATION_SECONDS,
      );
      const adapter = twilioAgentFactory({
        accountSid: env.accountSid,
        authToken: env.authToken,
        phoneNumber: env.fromNumber,
        publicBaseUrl: env.publicBaseUrl,
        allowedCallees,
      });
      // A single agent turn should never out-wait the whole-call budget the
      // child enforces; clamp the per-turn wait to it, as ElevenLabs does.
      if (typeof adapter.responseTimeout === "number") {
        adapter.responseTimeout = Math.min(
          adapter.responseTimeout,
          maxCallSeconds,
        );
      }
      // `agentId` is the phone target's own E.164 number (its external id).
      return withOutboundDial(adapter, {
        to: agentId,
        allowedCallees,
        maxCallDurationSeconds,
      }) as unknown as AgentAdapter;
    },

    async fetchCallRecord({ conversationId, audioProxyUrl }) {
      const env = readEnv();
      if (!env) throw new VoicePhoneTransportUnavailableError();
      // `conversationId` is the Twilio call SID. Ask for the call's recordings.
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        env.accountSid,
      )}/Recordings.json?CallSid=${encodeURIComponent(conversationId)}`;
      const response = await fetchImpl(url, {
        headers: { Authorization: twilioAuthHeader(env), accept: "application/json" },
        signal: AbortSignal.timeout(VOICE_HTTP_TIMEOUT_MS),
      });
      // No recording resource yet: not ready, the same "fall back to the live
      // transcript" signal the ElevenLabs path returns for a 404.
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Twilio recording fetch failed: Status code: ${response.status}`);
      }
      const body = (await response.json()) as TwilioRecordingsResponse;
      const recording = (body.recordings ?? []).find(
        (entry) => entry.status === "completed",
      );
      // Right after hang-up the recording is still `processing`/`in-progress`
      // (or absent); only a `completed` recording is ready. Anything else reads
      // as not-ready: return null and let the caller keep the live transcript.
      if (!recording) return null;
      const startedAt = parseTwilioStart(recording);
      const durationMs = Number(recording.duration ?? 0) * 1000;
      const record: CallRecord = {
        conversationId,
        transport: "phone",
        startedAt,
        endedAt: startedAt + durationMs,
        durationMs,
        // Twilio returns audio, not a diarized transcript; the run's turns come
        // from the SDK's live/STT capture during the call. The recording is
        // proxied through the app so the bytes never carry the Twilio auth.
        turns: [],
        audioUrl: audioProxyUrl,
        isCutAtLimit: false,
        source: "provider",
      };
      return record;
    },

    async endCall(adapter): Promise<void> {
      // Disconnect cancels the max-duration watchdog and hangs the call up; the
      // cast is sealed in this one vendor module, as ElevenLabs' is.
      await (adapter as { disconnect?: () => Promise<void> }).disconnect?.();
    },
  };
}

/** When Twilio reports a start time, use it; else the call is timestamped now. */
function parseTwilioStart(recording: TwilioRecording): number {
  const raw = recording.start_time ?? recording.date_created;
  if (!raw) return Date.now();
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** The production phone runner, reading Twilio from the operator environment. */
export const phoneTransport: VoiceTransportRunner = createPhoneTransport();
