/**
 * @see specs/features/agents/voice-phone.feature
 */

import { AgentRole } from "@langwatch/scenario";
import { describe, expect, it, vi } from "vitest";
import type { VoiceTransportCredential } from "../../voice-transport.registry";
import {
  createPhoneTransport,
  PHONE_CONNECT_REJECTED_PREFIX,
  PHONE_NO_BROWSER_CALL_MESSAGE,
  phoneTransport,
  resolveHttpPort,
  resolvePublicBaseUrl,
  TWILIO_MAX_CALL_DURATION_CAP_SECONDS,
  type TwilioAdapterLike,
  type TwilioAgentFactory,
  VoicePhoneTransportUnavailableError,
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
}

function fakeAdapter(
  behaviour: { connectRejects?: Error; placeCallRejects?: Error } = {},
): FakeAdapter {
  const placeCallArgs: Array<Parameters<TwilioAdapterLike["placeCall"]>[0]> =
    [];
  let disconnects = 0;
  return {
    placeCallArgs,
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
  };
}

function buildTransport({
  adapter = fakeAdapter(),
  processEnv = { VOICE_PUBLIC_BASE_URL: "https://voice.example.com" },
}: {
  adapter?: FakeAdapter;
  processEnv?: NodeJS.ProcessEnv;
} = {}) {
  const factoryOptions: Array<Parameters<TwilioAgentFactory>[0]> = [];
  const twilioAgentFactory: TwilioAgentFactory = (options) => {
    factoryOptions.push(options);
    return adapter;
  };
  const transport = createPhoneTransport({ twilioAgentFactory, processEnv });
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
      /** @scenario "VOICE_PUBLIC_BASE_URL is optional and falls back to the app's public base host" */
      it("falls back to the app's own base host", () => {
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

    describe("when VOICE_PUBLIC_BASE_URL is a scheme-less value", () => {
      it("throws naming VOICE_PUBLIC_BASE_URL and the offending value", () => {
        expect(() =>
          resolvePublicBaseUrl({ VOICE_PUBLIC_BASE_URL: "localhost:3000" }),
        ).toThrow(/VOICE_PUBLIC_BASE_URL/);
        expect(() =>
          resolvePublicBaseUrl({ VOICE_PUBLIC_BASE_URL: "localhost:3000" }),
        ).toThrow(/localhost:3000/);
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
          resolvePublicBaseUrl({ BASE_HOST: "not-a-valid-url" }),
        ).toThrow(/BASE_HOST/);
      });
    });
  });

  describe("given the http port is resolved", () => {
    describe("when VOICE_WS_PORT is a valid port", () => {
      it("uses it", () => {
        expect(resolveHttpPort({ VOICE_WS_PORT: "5564" })).toBe(5564);
      });
    });

    describe("when VOICE_WS_PORT is unset", () => {
      it("falls back to the OS-assigned port", () => {
        expect(resolveHttpPort({ VOICE_WS_PORT: undefined })).toBe(0);
      });
    });

    describe("when VOICE_WS_PORT is not a number", () => {
      it("falls back to the OS-assigned port", () => {
        expect(resolveHttpPort({ VOICE_WS_PORT: "not-a-port" })).toBe(0);
      });
    });

    describe("when VOICE_WS_PORT is out of range", () => {
      it("falls back to the OS-assigned port", () => {
        expect(resolveHttpPort({ VOICE_WS_PORT: "0" })).toBe(0);
        expect(resolveHttpPort({ VOICE_WS_PORT: "65536" })).toBe(0);
        expect(resolveHttpPort({ VOICE_WS_PORT: "-1" })).toBe(0);
      });
    });

    describe("when the phone transport builds the SDK adapter", () => {
      it("passes the resolved http port to the factory", () => {
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
        expect(factoryOptions[0]?.httpPort).toBe(5564);
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

        const transport = createPhoneTransport();
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

        const transport = createPhoneTransport();
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

        const transport = createPhoneTransport();
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

        const transport = createPhoneTransport();
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
