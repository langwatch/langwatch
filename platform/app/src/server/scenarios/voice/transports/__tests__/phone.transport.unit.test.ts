/**
 * @see specs/features/agents/voice-phone.feature
 */

import type { Socket } from "node:net";
import { AgentRole } from "@langwatch/scenario";
import { describe, expect, it, vi } from "vitest";
import type {
  ReceivedVoiceSocket,
  VoiceSocketReceiver,
} from "../../voice-socket-handoff";
import type { VoiceTransportCredential } from "../../voice-transport.registry";
import {
  createPhoneTransport,
  PHONE_CONNECT_REJECTED_PREFIX,
  PHONE_NO_BROWSER_CALL_MESSAGE,
  phoneTransport,
  resolvePublicBaseUrl,
  TWILIO_MAX_CALL_DURATION_CAP_SECONDS,
  type TwilioAdapterLike,
  type TwilioAgentFactory,
  VoicePhoneTransportUnavailableError,
  VoicePublicBaseUrlMissingError,
} from "../phone.transport";

const twilioAgentMock = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/scenario", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/scenario")>();
  return {
    ...actual,
    voice: {
      ...actual.voice,
      twilioAgent: twilioAgentMock,
    },
  };
});

const TWILIO_CREDENTIAL: VoiceTransportCredential = {
  kind: "twilio",
  accountSid: "AC123",
  authToken: "tok-secret",
  fromNumber: "+14155550000",
};

/** The E.164 destination under test, dialled as the a-leg. */
const TARGET = "+14155559999";

/** The connect() a runner exposes on the SDK adapter it returns. */
type Connectable = { connect: () => Promise<void> };

/** The vendor SDK's own `placeCall` argument shape: `shouldRecord` swapped for
 *  the SDK's published `record`, mirroring the (unexported) `SdkTwilioAdapter`
 *  translation in phone.transport.ts. Derived from the exported
 *  `TwilioAdapterLike` so it tracks that type instead of duplicating it. */
type SdkPlaceCallArgs = Omit<
  Parameters<TwilioAdapterLike["placeCall"]>[0],
  "shouldRecord"
> & { record?: boolean };

interface FakeAdapter extends TwilioAdapterLike {
  readonly placeCallArgs: Array<Parameters<TwilioAdapterLike["placeCall"]>[0]>;
  readonly disconnectCount: () => number;
  readonly receivedSockets: Array<
    Parameters<NonNullable<TwilioAdapterLike["receiveExternalMediaSocket"]>>[0]
  >;
}

function fakeAdapter(
  behaviour: { connectRejects?: Error; placeCallRejects?: Error } = {},
): FakeAdapter {
  const placeCallArgs: Array<Parameters<TwilioAdapterLike["placeCall"]>[0]> =
    [];
  const receivedSockets: Array<
    Parameters<NonNullable<TwilioAdapterLike["receiveExternalMediaSocket"]>>[0]
  > = [];
  let disconnects = 0;
  return {
    placeCallArgs,
    receivedSockets,
    disconnectCount: () => disconnects,
    connect: vi.fn(async () => {
      if (behaviour.connectRejects) throw behaviour.connectRejects;
    }),
    disconnect: vi.fn(async () => {
      disconnects += 1;
    }),
    placeCall: vi.fn(async (args) => {
      placeCallArgs.push(args);
      if (behaviour.placeCallRejects) throw behaviour.placeCallRejects;
    }),
    receiveExternalMediaSocket: vi.fn((params) => {
      receivedSockets.push(params);
    }),
  };
}

/** A registrar that acks immediately — the default for every test that isn't
 *  itself exercising the nonce-registration handshake. Real production code
 *  goes through the IPC round-trip in voice-nonce-handoff.ts instead. */
function autoAckRegisterNonce(): Promise<void> {
  return Promise.resolve();
}

/** A no-op race — the default for every test that isn't itself exercising the
 *  upgrade-refusal handshake. Passes the promise through unchanged instead of
 *  attaching a real `process` IPC listener. */
function identityRaceUpgradeRefusal<T>(promise: Promise<T>): Promise<T> {
  return promise;
}

/** A fake receiver a test can trigger manually, standing in for a real
 *  `createVoiceSocketReceiver()` listening on process IPC. */
function fakeSocketReceiver(): VoiceSocketReceiver & {
  emit: (received: ReceivedVoiceSocket) => void;
} {
  let handler: ((received: ReceivedVoiceSocket) => void) | undefined;
  return {
    onVoiceSocket: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
    emit: (received) => handler?.(received),
  };
}

function buildTransport({
  adapter = fakeAdapter(),
  processEnv = { VOICE_PUBLIC_BASE_URL: "https://voice.example.com" },
  registerNonce = autoAckRegisterNonce,
  mintNonce,
  raceUpgradeRefusal = identityRaceUpgradeRefusal,
  socketReceiver = fakeSocketReceiver(),
}: {
  adapter?: FakeAdapter;
  processEnv?: NodeJS.ProcessEnv;
  registerNonce?: (params: { nonce: string }) => Promise<void>;
  mintNonce?: () => string;
  raceUpgradeRefusal?: <T>(promise: Promise<T>) => Promise<T>;
  socketReceiver?: VoiceSocketReceiver;
} = {}) {
  const factoryOptions: Array<Parameters<TwilioAgentFactory>[0]> = [];
  const twilioAgentFactory: TwilioAgentFactory = (options) => {
    factoryOptions.push(options);
    return adapter;
  };
  const transport = createPhoneTransport({
    twilioAgentFactory,
    processEnv,
    registerNonce,
    raceUpgradeRefusal,
    socketReceiver,
    ...(mintNonce ? { mintNonce } : {}),
  });
  return { transport, adapter, factoryOptions };
}

describe("phoneTransport", () => {
  describe("given a phone target with a valid Twilio credential", () => {
    describe("when the run places the call", () => {
      /** @scenario "A phone call dials the target number over the account's own line" */
      it("dials the target as an a-leg call from the account's own number", async () => {
        const { transport, adapter, factoryOptions } = buildTransport();
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        await (built as unknown as Connectable).connect();

        expect(factoryOptions[0]?.accountSid).toBe("AC123");
        expect(factoryOptions[0]?.authToken).toBe("tok-secret");
        // The account's OWN number is the "from", never the destination.
        expect(factoryOptions[0]?.phoneNumber).toBe("+14155550000");
        expect(factoryOptions[0]?.role).toBe(AgentRole.AGENT);
        expect(adapter.placeCallArgs[0]).toMatchObject({
          to: TARGET,
          attachStream: "a-leg",
          // Recording stays enabled; our option name is `shouldRecord`, mapped
          // to the SDK's published `record` at the vendor boundary (#8014).
          shouldRecord: true,
        });
      });

      /** @scenario "A phone call allows only the dialled number" */
      it("passes only the dialled target to the transport's internal allowlist", () => {
        const { transport, factoryOptions } = buildTransport();
        transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        expect(factoryOptions[0]?.allowedCallees).toEqual([TARGET]);
      });
    });

    describe("when the project's call limit is above the transport's cap", () => {
      /** @scenario "A phone call's duration is capped at the transport's hard limit" */
      it("clamps the call duration to the transport's own maximum", async () => {
        const { transport, adapter } = buildTransport();
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 600,
        });
        await (built as unknown as Connectable).connect();
        expect(adapter.placeCallArgs[0]?.maxCallDurationSeconds).toBe(
          TWILIO_MAX_CALL_DURATION_CAP_SECONDS,
        );
      });
    });

    describe("when the project's call limit is below the transport's cap", () => {
      it("dials with the project's own smaller limit", async () => {
        const { transport, adapter } = buildTransport();
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 90,
        });
        await (built as unknown as Connectable).connect();
        expect(adapter.placeCallArgs[0]?.maxCallDurationSeconds).toBe(90);
      });
    });

    describe("when the live call is ended", () => {
      /** @scenario "Ending a phone call while it is live hangs up the call" */
      it("hangs up by disconnecting the adapter", async () => {
        const { transport, adapter } = buildTransport();
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        await transport.endCall(built);
        expect(adapter.disconnectCount()).toBe(1);
      });
    });

    describe("when the a-leg dial is refused", () => {
      /** @scenario "A phone run fails clearly when Twilio refuses the call" */
      it("surfaces the refusal as the run's error and releases the socket", async () => {
        const adapter = fakeAdapter({
          placeCallRejects: new Error("callee not allowed"),
        });
        const { transport } = buildTransport({ adapter });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        await expect(
          (built as unknown as Connectable).connect(),
        ).rejects.toThrow(PHONE_CONNECT_REJECTED_PREFIX);
        expect(adapter.disconnectCount()).toBe(1);
      });
    });

    describe("when the connect handshake fails", () => {
      it("surfaces the failure as the run's error, never dials, and disconnects the adapter", async () => {
        const adapter = fakeAdapter({
          connectRejects: new Error("edge not reachable"),
        });
        const { transport } = buildTransport({ adapter });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        await expect(
          (built as unknown as Connectable).connect(),
        ).rejects.toThrow(PHONE_CONNECT_REJECTED_PREFIX);
        expect(adapter.placeCallArgs).toHaveLength(0);
        expect(adapter.disconnectCount()).toBe(1);
      });
    });

    describe("when the transport dials, given the parent's nonce registration", () => {
      /**
       * This is the production gap: the parent worker's media listener
       * authenticates Twilio's dial-back against a nonce it must already
       * know. The child must register the nonce with the parent and get the
       * ack back BEFORE dialling — proven here by ORDER, not by spying on an
       * internal: the fake registrar itself records when it ran relative to
       * placeCall.
       */
      /** @scenario "A phone call registers its stream nonce with the parent before dialling" */
      it("registers the nonce and awaits the ack before placeCall runs", async () => {
        const events: string[] = [];
        const adapter = fakeAdapter();
        const originalPlaceCall = adapter.placeCall;
        adapter.placeCall = vi.fn(async (args) => {
          events.push("placeCall");
          return originalPlaceCall(args);
        });
        const registerNonce = vi.fn(async ({ nonce }: { nonce: string }) => {
          events.push(`registerNonce:${nonce}`);
          // A real IPC round-trip is asynchronous; yield a tick so a caller
          // that (incorrectly) didn't await this promise would let placeCall
          // run first, and the ordering assertion below would catch it.
          await Promise.resolve();
        });
        const { transport } = buildTransport({
          adapter,
          registerNonce,
          mintNonce: () => "fixed-nonce-for-ordering-test",
        });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        await (built as unknown as Connectable).connect();

        expect(events).toEqual([
          "registerNonce:fixed-nonce-for-ordering-test",
          "placeCall",
        ]);
        expect(adapter.placeCallArgs[0]).toMatchObject({
          streamNonce: "fixed-nonce-for-ordering-test",
        });
      });

      /** @scenario "A phone call fails loudly when the parent never acknowledges the nonce" */
      it("fails the dial and never calls placeCall when the parent never acks", async () => {
        const adapter = fakeAdapter();
        const registerNonce = vi.fn(
          () => new Promise<void>(() => {}), // never resolves or rejects
        );
        const { transport } = buildTransport({ adapter, registerNonce });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });

        // Race the real connect() against a short local timeout: a caller
        // that (incorrectly) didn't wait on registerNonce would resolve
        // connect() almost immediately and this test would see "resolved".
        const outcome = await Promise.race([
          (built as unknown as Connectable)
            .connect()
            .then(() => "resolved" as const)
            .catch(() => "rejected" as const),
          new Promise<"timed-out">((resolve) =>
            setTimeout(() => resolve("timed-out"), 50),
          ),
        ]);

        expect(outcome).toBe("timed-out");
        expect(adapter.placeCallArgs).toHaveLength(0);
        expect(registerNonce).toHaveBeenCalledTimes(1);
      });

      /** @scenario "A phone call fails loudly when the parent refuses the nonce" */
      it("surfaces the parent's refusal as the run's error and never dials", async () => {
        const adapter = fakeAdapter();
        const registerNonce = vi.fn(async () => {
          throw new Error("no voice listener booted in this process");
        });
        const { transport } = buildTransport({ adapter, registerNonce });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });

        await expect(
          (built as unknown as Connectable).connect(),
        ).rejects.toThrow(PHONE_CONNECT_REJECTED_PREFIX);
        expect(adapter.placeCallArgs).toHaveLength(0);
        expect(adapter.disconnectCount()).toBe(1);
      });
    });

    describe("when the listener refuses the socket after the nonce was registered", () => {
      /**
       * A nonce can outlive its registration (the listener's TTL, or a
       * config mistake) and still get refused after Twilio actually rings
       * the callee. Without this race, `connect()` would sit and burn
       * `placeCall`'s full connect-wait timeout, then fail with a generic
       * "stream never connected" that hides the real cause. `raceUpgradeRefusal`
       * is what a real IPC-listening race would do; this test drives a fake
       * one that "delivers" a refusal after placeCall has started dialling.
       */
      /** @scenario "A phone call fails fast when the listener refuses the socket mid-dial" */
      it("fails fast with the refusal reason instead of waiting out placeCall", async () => {
        const adapter = fakeAdapter();
        // placeCall itself never settles on its own — only the race's
        // refusal path can end this connect().
        adapter.placeCall = vi.fn(() => new Promise<void>(() => {}));
        const raceUpgradeRefusal = vi.fn(
          <T>(_promise: Promise<T>): Promise<T> =>
            Promise.reject(
              new Error(
                "Twilio's media socket was refused by the listener: nonce expired",
              ),
            ) as Promise<T>,
        );
        const { transport } = buildTransport({
          adapter,
          raceUpgradeRefusal: raceUpgradeRefusal as <T>(
            promise: Promise<T>,
          ) => Promise<T>,
        });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });

        await expect(
          (built as unknown as Connectable).connect(),
        ).rejects.toThrow(/nonce expired/);
        expect(raceUpgradeRefusal).toHaveBeenCalledTimes(1);
        expect(adapter.disconnectCount()).toBe(1);
      });

      /** @scenario "A phone call fails fast when the listener refuses the socket mid-dial" */
      it("still connects normally when no refusal ever arrives", async () => {
        const adapter = fakeAdapter();
        const { transport } = buildTransport({ adapter });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });

        await expect(
          (built as unknown as Connectable).connect(),
        ).resolves.toBeUndefined();
        expect(adapter.placeCallArgs).toHaveLength(1);
      });
    });

    describe("given the parent has handed off Twilio's media socket", () => {
      /**
       * The other half of the nonce-registration handshake: once Twilio
       * dials back, the PARENT worker's listener accepts the raw upgrade
       * socket and hands it to this child over IPC
       * (`handOffVoiceSocket`/`createVoiceSocketReceiver`). Without this
       * wiring, nonce registration and dialling would succeed but the
       * arriving socket would have nowhere to go and the call would still
       * never connect — this proves the wiring is real, not a no-op.
       */
      /** @scenario "The child feeds a handed-off Twilio socket into its own adapter" */
      it("forwards the received socket into the adapter's own upgrade handler", () => {
        const adapter = fakeAdapter();
        const receiver = fakeSocketReceiver();
        const { transport } = buildTransport({
          adapter,
          socketReceiver: receiver,
        });
        transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });

        const socket = {} as Socket;
        const head = Buffer.from("pipelined-bytes");
        receiver.emit({
          message: {
            type: "voice:twilio-media-socket",
            nonce: "n1",
            url: "/twilio/n1",
            method: "GET",
            headers: { host: "voice.example.com" },
            headBase64: head.toString("base64"),
          },
          socket,
          head,
        });

        expect(adapter.receivedSockets).toHaveLength(1);
        expect(adapter.receivedSockets[0]).toEqual({
          req: {
            method: "GET",
            url: "/twilio/n1",
            headers: { host: "voice.example.com" },
          },
          socket,
          head,
        });
      });

      it("does nothing when no socket has been handed off", () => {
        const adapter = fakeAdapter();
        const { transport } = buildTransport({ adapter });
        transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        expect(adapter.receivedSockets).toHaveLength(0);
      });
    });
  });

  describe("given a credential built for another transport", () => {
    describe("when the phone runner builds its adapter", () => {
      it("throws rather than reading a shape it cannot use", () => {
        const { transport } = buildTransport();
        expect(() =>
          transport.createAgentAdapter({
            agentId: TARGET,
            credential: {
              kind: "elevenlabs",
              apiKey: "k",
              baseUrl: "https://x",
            },
            maxCallSeconds: 120,
          }),
        ).toThrow(/elevenlabs credential/);
      });
    });
  });

  describe("given a phone target has no browser call", () => {
    describe("when a browser session mint or record is attempted", () => {
      /** @scenario "A phone target has no browser call" */
      it("throws the unavailable error from every browser-only method", () => {
        const assertThrows = (call: () => unknown) => {
          expect(call).toThrow(VoicePhoneTransportUnavailableError);
          try {
            call();
          } catch (error) {
            expect((error as VoicePhoneTransportUnavailableError).code).toBe(
              "voice_phone_transport_unavailable",
            );
            expect((error as Error).message).toBe(
              PHONE_NO_BROWSER_CALL_MESSAGE,
            );
          }
        };
        assertThrows(() => phoneTransport.assertAvailable?.());
        assertThrows(() =>
          phoneTransport.mintSession({
            agentId: TARGET,
            credential: TWILIO_CREDENTIAL,
          }),
        );
        assertThrows(() =>
          phoneTransport.fetchCallRecord({
            conversationId: "c",
            credential: TWILIO_CREDENTIAL,
            audioProxyUrl: "/audio",
          }),
        );
      });
    });
  });

  describe("given the public base URL is resolved", () => {
    describe("when VOICE_PUBLIC_BASE_URL is set", () => {
      it("uses it over the app's own base host", () => {
        expect(
          resolvePublicBaseUrl({
            VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
            BASE_HOST: "https://app.example.com",
          }),
        ).toBe("https://voice.example.com");
      });
    });

    describe("when VOICE_PUBLIC_BASE_URL is unset", () => {
      // The resolver HELPER still reports BASE_HOST (and its source), which is
      // how the phone transport detects and then refuses it — see the
      // "no public media URL" fail-fast block below. This asserts the helper's
      // reporting behavior, not that a real call is allowed to use it.
      it("still reports the app's own base host from the resolver helper", () => {
        expect(
          resolvePublicBaseUrl({ BASE_HOST: "https://app.example.com" }),
        ).toBe("https://app.example.com");
      });
    });

    describe("when neither is set", () => {
      it("resolves to undefined", () => {
        expect(resolvePublicBaseUrl({})).toBeUndefined();
      });
    });

    describe("when the value is a valid https URL", () => {
      it("passes through unchanged", () => {
        expect(
          resolvePublicBaseUrl({
            VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
          }),
        ).toBe("https://voice.example.com");
      });
    });

    describe("when the value is a valid http URL", () => {
      it("passes through unchanged", () => {
        expect(
          resolvePublicBaseUrl({
            VOICE_PUBLIC_BASE_URL: "http://voice.example.com",
          }),
        ).toBe("http://voice.example.com");
      });
    });

    describe("when the value has a trailing slash", () => {
      it("behaves as it does today: passes through with the trailing slash intact", () => {
        expect(
          resolvePublicBaseUrl({
            VOICE_PUBLIC_BASE_URL: "https://voice.example.com/",
          }),
        ).toBe("https://voice.example.com/");
      });
    });

    describe("when VOICE_PUBLIC_BASE_URL is a scheme-less localhost value", () => {
      it("is normalized to an http URL", () => {
        expect(
          resolvePublicBaseUrl({ VOICE_PUBLIC_BASE_URL: "localhost:3000" }),
        ).toBe("http://localhost:3000");
      });
    });

    describe("when VOICE_PUBLIC_BASE_URL is a scheme-less non-local host", () => {
      it("is normalized to an https URL", () => {
        expect(
          resolvePublicBaseUrl({ VOICE_PUBLIC_BASE_URL: "voice.example.com" }),
        ).toBe("https://voice.example.com");
      });
    });

    describe("when VOICE_PUBLIC_BASE_URL is garbage", () => {
      it("throws naming VOICE_PUBLIC_BASE_URL", () => {
        expect(() =>
          resolvePublicBaseUrl({ VOICE_PUBLIC_BASE_URL: "not a url at all" }),
        ).toThrow(/VOICE_PUBLIC_BASE_URL/);
      });
    });

    describe("when BASE_HOST is malformed and VOICE_PUBLIC_BASE_URL is unset", () => {
      it("throws naming BASE_HOST rather than VOICE_PUBLIC_BASE_URL", () => {
        expect(() =>
          resolvePublicBaseUrl({ BASE_HOST: "not a valid url" }),
        ).toThrow(/BASE_HOST/);
      });
    });
  });

  describe("given a phone target but no public media URL the worker answers", () => {
    describe("when only the app's BASE_HOST is set", () => {
      /** @scenario "A phone run fails fast when only the app's base host is available" */
      it("refuses to build the adapter, naming VOICE_PUBLIC_BASE_URL and the cloudflared remedy, and never dials", () => {
        const adapter = fakeAdapter();
        const { transport, factoryOptions } = buildTransport({
          adapter,
          processEnv: { BASE_HOST: "https://app.langwatch.ai" },
        });

        let thrown: unknown;
        try {
          transport.createAgentAdapter({
            agentId: TARGET,
            credential: TWILIO_CREDENTIAL,
            maxCallSeconds: 120,
          });
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(VoicePublicBaseUrlMissingError);
        expect((thrown as Error).message).toContain("VOICE_PUBLIC_BASE_URL");
        expect((thrown as Error).message).toContain("cloudflared");
        // The adapter was never built, so the SDK factory never ran and no dial
        // could have gone out against the app's own host.
        expect(factoryOptions).toHaveLength(0);
        expect(adapter.placeCallArgs).toHaveLength(0);
      });
    });

    describe("when neither VOICE_PUBLIC_BASE_URL nor BASE_HOST is set", () => {
      /** @scenario "A phone run fails fast when no public base URL is available at all" */
      it("refuses to build the adapter rather than dialling a URL nothing answers", () => {
        const adapter = fakeAdapter();
        const { transport, factoryOptions } = buildTransport({
          adapter,
          processEnv: {},
        });

        expect(() =>
          transport.createAgentAdapter({
            agentId: TARGET,
            credential: TWILIO_CREDENTIAL,
            maxCallSeconds: 120,
          }),
        ).toThrow(VoicePublicBaseUrlMissingError);
        expect(factoryOptions).toHaveLength(0);
        expect(adapter.placeCallArgs).toHaveLength(0);
      });
    });
  });

  describe("given the child's SDK adapter http port", () => {
    describe("when the phone transport builds the SDK adapter", () => {
      /** @scenario "A phone call's scenario child never binds the worker's media port" */
      it("always passes an OS-assigned port, even when VOICE_WS_PORT is set in the environment", () => {
        const { transport, factoryOptions } = buildTransport({
          processEnv: {
            VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
            VOICE_WS_PORT: "5564",
          },
        });
        transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        expect(factoryOptions[0]?.httpPort).toBe(0);
      });
    });
  });

  describe("given the default Twilio agent factory (no injected fake)", () => {
    describe("when it builds the adapter for an agent target", () => {
      /** @scenario "The default phone factory returns the SDK's own adapter instance" */
      it("returns the exact SDK adapter instance the SDK constructor produced", () => {
        const sdkAdapter = {
          role: AgentRole.AGENT,
          connect: vi.fn(async () => {}),
          disconnect: vi.fn(async () => {}),
          placeCall: vi.fn(async () => {}),
        };
        twilioAgentMock.mockReturnValue(sdkAdapter);

        const transport = createPhoneTransport({
          processEnv: { VOICE_PUBLIC_BASE_URL: "https://voice.example.com" },
          registerNonce: autoAckRegisterNonce,
          raceUpgradeRefusal: identityRaceUpgradeRefusal,
        });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });

        expect(built).toBe(sdkAdapter);
      });

      /** @scenario "The default phone factory preserves the SDK adapter's role" */
      it("keeps the SDK adapter's role readable on the returned adapter", () => {
        const sdkAdapter = {
          role: AgentRole.AGENT,
          connect: vi.fn(async () => {}),
          disconnect: vi.fn(async () => {}),
          placeCall: vi.fn(async () => {}),
        };
        twilioAgentMock.mockReturnValue(sdkAdapter);

        const transport = createPhoneTransport({
          processEnv: { VOICE_PUBLIC_BASE_URL: "https://voice.example.com" },
          registerNonce: autoAckRegisterNonce,
          raceUpgradeRefusal: identityRaceUpgradeRefusal,
        });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });

        expect((built as unknown as { role: AgentRole }).role).toBe(
          AgentRole.AGENT,
        );
      });

      /** @scenario "The default phone factory translates shouldRecord to the SDK's record option" */
      it("translates shouldRecord to the SDK's record option on placeCall, without leaking shouldRecord through", async () => {
        const placeCall = vi.fn(async (_args: SdkPlaceCallArgs) => {});
        const sdkAdapter = {
          role: AgentRole.AGENT,
          connect: vi.fn(async () => {}),
          disconnect: vi.fn(async () => {}),
          placeCall,
        };
        twilioAgentMock.mockReturnValue(sdkAdapter);

        const transport = createPhoneTransport({
          processEnv: { VOICE_PUBLIC_BASE_URL: "https://voice.example.com" },
          registerNonce: autoAckRegisterNonce,
          raceUpgradeRefusal: identityRaceUpgradeRefusal,
        });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        await (built as unknown as Connectable).connect();

        expect(placeCall).toHaveBeenCalledTimes(1);
        const call = placeCall.mock.calls[0]?.[0];
        expect(call).toMatchObject({
          to: TARGET,
          attachStream: "a-leg",
          record: true,
        });
        expect(call).not.toHaveProperty("shouldRecord");
      });

      /** @scenario "The default phone factory still delegates connect and disconnect to the SDK adapter" */
      it("still delegates connect and disconnect to the SDK adapter", async () => {
        const connect = vi.fn(async () => {});
        const disconnect = vi.fn(async () => {});
        const sdkAdapter = {
          role: AgentRole.AGENT,
          connect,
          disconnect,
          placeCall: vi.fn(async () => {}),
        };
        twilioAgentMock.mockReturnValue(sdkAdapter);

        const transport = createPhoneTransport({
          processEnv: { VOICE_PUBLIC_BASE_URL: "https://voice.example.com" },
          registerNonce: autoAckRegisterNonce,
          raceUpgradeRefusal: identityRaceUpgradeRefusal,
        });
        const built = transport.createAgentAdapter({
          agentId: TARGET,
          credential: TWILIO_CREDENTIAL,
          maxCallSeconds: 120,
        });
        await (built as unknown as Connectable).connect();
        expect(connect).toHaveBeenCalledTimes(1);

        await transport.endCall(built);
        expect(disconnect).toHaveBeenCalledTimes(1);
      });
    });
  });
});
