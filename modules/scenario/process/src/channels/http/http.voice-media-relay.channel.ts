import type { IncomingMessage } from "node:http";

import WebSocket, { type RawData } from "ws";
import { z } from "zod";

import { closeToPassOn, frameBytes } from "../../rules/websocket.rules.ts";
import type {
  VoiceMediaRelay,
  VoiceMediaRelayChannel,
  VoiceMediaRelayCredential,
  VoiceMediaRelayEnd,
  VoiceMediaRelayFrame,
  VoiceMediaRelayOpenResult,
  VoiceMediaRelayRefusal,
} from "../voice-media-relay.channels.ts";

const RELAY_PATH = "/v1/voice/relay";
const STREAM_PATH = /^\/v1\/voice\/twilio\/[A-Za-z0-9_-]+$/;
/** Bounds the upgrade and the ready frame together. */
const OPEN_TIMEOUT_MS = 10_000;
/** The gateway refuses a frame over 64 KiB either way. */
const MAX_FRAME_BYTES = 64 * 1024;
/** A refusal body is one small JSON error; anything longer is not read. */
const MAX_REFUSAL_BYTES = 4096;
const PROTOCOL_ERROR = { code: 1002, reason: "relay_protocol_error" };

const readyFrameSchema = z.object({
  event: z.literal("langwatch.relay.ready"),
  relay_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  stream_path: z.string().regex(STREAM_PATH),
});
const joinedFrameSchema = z.object({
  event: z.literal("langwatch.relay.joined"),
  twilio_signature: z.string().optional(),
});
const refusalSchema = z.object({
  error: z.object({ code: z.string().optional(), type: z.string().optional() }),
});

type JoinOutcome = Awaited<VoiceMediaRelay["joined"]>;

/**
 * Opens relays on the LangWatch gateway over a WebSocket, authenticated by the install's license
 * token and instance id, the same pair a Connect call presents. No compression: media frames are
 * small and already compressed, and the gateway negotiates none.
 */
export class HttpVoiceMediaRelayChannel implements VoiceMediaRelayChannel {
  static create(): HttpVoiceMediaRelayChannel {
    return new HttpVoiceMediaRelayChannel();
  }

  private constructor() {}

  open({
    credential,
  }: {
    credential: VoiceMediaRelayCredential;
  }): Promise<VoiceMediaRelayOpenResult> {
    const socket = new WebSocket(socketUrl({ baseUrl: credential.baseUrl, path: RELAY_PATH }), {
      headers: {
        authorization: `Bearer ${credential.token}`,
        "x-langwatch-instance": credential.instanceId,
      },
      perMessageDeflate: false,
      followRedirects: false,
      handshakeTimeout: OPEN_TIMEOUT_MS,
      maxPayload: MAX_FRAME_BYTES,
    });
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: VoiceMediaRelayOpenResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const refuse = (refusal: VoiceMediaRelayRefusal): void => {
        settle({ opened: false, refusal });
        socket.terminate();
      };
      const timer = setTimeout(
        () => refuse({ status: 0, code: "relay_open_timeout" }),
        OPEN_TIMEOUT_MS,
      );

      const onOpeningError = (): void => refuse({ status: 0 });
      const onOpeningClose = (): void => refuse({ status: 0 });
      socket.once("unexpected-response", (_request, response) => {
        void refusalOf(response).then(refuse);
      });
      socket.on("error", onOpeningError);
      socket.once("close", onOpeningClose);
      socket.once("message", (data, isBinary) => {
        const ready = isBinary ? undefined : parseJson({ data, schema: readyFrameSchema });
        if (!ready) {
          settle({ opened: false, refusal: { status: 0, code: "relay_protocol_error" } });
          socket.close(PROTOCOL_ERROR.code, PROTOCOL_ERROR.reason);
          return;
        }
        // These opening-phase listeners would otherwise outlive the handshake and
        // terminate the socket on a later, unrelated error or close of an open relay.
        socket.off("error", onOpeningError);
        socket.off("close", onOpeningClose);
        // Built inside this listener, so it hears every frame after the ready frame.
        const relay = WsVoiceMediaRelay.create({
          socket,
          relayId: ready.relay_id,
          streamUrl: socketUrl({ baseUrl: credential.baseUrl, path: ready.stream_path }),
        });
        settle({ opened: true, relay });
      });
    });
  }
}

/** One open relay: waits for Twilio's join, then carries its frames until either end closes. */
class WsVoiceMediaRelay implements VoiceMediaRelay {
  static create(input: {
    socket: WebSocket;
    relayId: string;
    streamUrl: string;
  }): WsVoiceMediaRelay {
    return new WsVoiceMediaRelay(input.socket, input.relayId, input.streamUrl);
  }

  readonly logId: string;
  readonly joined: Promise<JoinOutcome>;
  private settleJoin: (outcome: JoinOutcome) => void = () => undefined;
  private isJoined = false;
  private readonly early: VoiceMediaRelayFrame[] = [];
  private frameHandler: ((frame: VoiceMediaRelayFrame) => void) | undefined;
  private ended: VoiceMediaRelayEnd | undefined;
  private readonly endHandlers: ((end: VoiceMediaRelayEnd) => void)[] = [];

  private constructor(
    private readonly socket: WebSocket,
    relayId: string,
    readonly streamUrl: string,
  ) {
    this.logId = relayId.slice(0, 8);
    this.joined = new Promise((resolve) => {
      this.settleJoin = resolve;
    });
    socket.on("message", (data, isBinary) => this.receive({ data: frameBytes(data), isBinary }));
    socket.on("close", (code, reason) => this.end({ code, reason: reason.toString() }));
    // A socket error is always followed by its close, which ends the relay.
    socket.on("error", () => undefined);
  }

  onFrame(handler: (frame: VoiceMediaRelayFrame) => void): void {
    this.frameHandler = handler;
    for (const frame of this.early.splice(0)) handler(frame);
  }

  send(frame: VoiceMediaRelayFrame): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(frame.data, { binary: frame.isBinary });
    }
  }

  onEnd(handler: (end: VoiceMediaRelayEnd) => void): void {
    if (this.ended) handler(this.ended);
    else this.endHandlers.push(handler);
  }

  close(end: VoiceMediaRelayEnd): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    const { code, reason } = closeToPassOn({ ...end, fallback: 1000 });
    this.socket.close(code, reason);
  }

  private receive(frame: VoiceMediaRelayFrame): void {
    if (this.isJoined) {
      if (this.frameHandler) this.frameHandler(frame);
      else this.early.push(frame);
      return;
    }
    const joined = frame.isBinary
      ? undefined
      : parseJson({ data: frame.data, schema: joinedFrameSchema });
    if (!joined) {
      this.close(PROTOCOL_ERROR);
      return;
    }
    this.isJoined = true;
    this.settleJoin({ joined: true, twilioSignature: joined.twilio_signature });
  }

  private end(end: VoiceMediaRelayEnd): void {
    if (this.ended) return;
    this.ended = end;
    if (!this.isJoined) this.settleJoin({ joined: false, end });
    for (const handler of this.endHandlers.splice(0)) handler(end);
  }
}

/** `path` on the gateway's origin, as a WebSocket URL: wss for https, ws for plain http. */
function socketUrl({ baseUrl, path }: { baseUrl: string; path: string }): string {
  const url = new URL(path, baseUrl);
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
  return url.toString();
}

function parseJson<T>({
  data,
  schema,
}: {
  data: RawData | Buffer;
  schema: z.ZodType<T>;
}): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(frameBytes(data).toString("utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A refused upgrade's status, with the gateway's error code when its body names one. */
async function refusalOf(response: IncomingMessage): Promise<VoiceMediaRelayRefusal> {
  const status = response.statusCode ?? 0;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      const buffer = frameBytes(chunk as Buffer);
      size += buffer.length;
      if (size > MAX_REFUSAL_BYTES) break;
      chunks.push(buffer);
    }
  } catch {
    return { status };
  }
  const body = parseJson({ data: Buffer.concat(chunks), schema: refusalSchema });
  const code = body?.error.code ?? body?.error.type;
  return code ? { status, code } : { status };
}
