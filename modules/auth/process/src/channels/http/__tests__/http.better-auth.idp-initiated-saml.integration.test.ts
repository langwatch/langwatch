/**
 * Sign-ins a SAML identity provider starts, through the real Better Auth SSO plugin carrying this
 * channel's `saml` options. Only the identity provider is a stand-in, signing with keys made here.
 * @see specs/identity/sso-saml-idp-initiated.feature
 */
import { inflateRawSync } from "node:zlib";

import { sso } from "@better-auth/sso";
import { ssoSamlIdpConfigSchema } from "@langwatch/identity-contract";
import {
  createSigningIdentity,
  type SamlAssertionClaims,
  type SigningIdentity,
  signSamlResponse,
} from "@langwatch/test-harness/saml-signer";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ssoSamlOptions } from "../http.better-auth.channel.ts";

const BASE_URL = "http://localhost:5624";
const PROVIDER_ID = "acme-okta";
const IDP_ENTITY_ID = "https://idp.acme.test/entity";
const SP_ENTITY_ID = "https://app.langwatch.test/sso/acme";
const ACS_URL = `${BASE_URL}/api/auth/sso/saml2/sp/acs/${PROVIDER_ID}`;
const EMAIL = "carol@acme.com";
const OTHER_EMAIL = "dave@acme.com";

type IdpInitiated = z.infer<typeof ssoSamlIdpConfigSchema>["idpInitiated"];
const OFF: IdpInitiated = { enabled: false, landingTargets: [] };
const OPTED_IN: IdpInitiated = { enabled: true, landingTargets: ["/acme/messages"] };

const idp = createSigningIdentity({ commonName: "idp.acme.test" });
const stranger = createSigningIdentity({ commonName: "stranger.example.test" });
const startedSchema = z.object({ url: z.string() });

/** The document `samlProviderDocument` writes; `undefined` is one written before the opt-in. */
function samlConnection(idpInitiated: IdpInitiated | undefined) {
  return {
    providerId: PROVIDER_ID,
    domain: "acme.com",
    samlConfig: {
      issuer: IDP_ENTITY_ID,
      entryPoint: "https://idp.acme.test/sso",
      callbackUrl: `${BASE_URL}/`,
      cert: idp.certificatePem,
      idpMetadata: { entityID: IDP_ENTITY_ID },
      spMetadata: { entityID: SP_ENTITY_ID },
      wantAssertionsSigned: true,
      mapping: { id: "nameID", email: "email" },
      ...(idpInitiated === undefined
        ? {}
        : { allowIdpInitiated: idpInitiated.enabled, idpInitiated }),
    },
  };
}

type MemoryEngine = ReturnType<typeof memoryAdapter>;

/** The memory store, refusing a second row under an id it holds, as a primary key does. */
function refusingHeldIds(engine: MemoryEngine): MemoryEngine {
  return (options) => {
    const adapter = engine(options);
    return {
      ...adapter,
      create: async (input) => {
        const id = "id" in input.data ? input.data.id : null;
        const held =
          typeof id === "string" &&
          (await adapter.findOne({ model: input.model, where: [{ field: "id", value: id }] }));
        if (held) throw new Error(`Unique constraint failed on ${input.model}.id`);
        return adapter.create(input);
      },
    };
  };
}

function deployment(idpInitiated: IdpInitiated | undefined) {
  const database = { user: [], session: [], account: [], verification: [] };
  const logged: { level: string; args: unknown[] }[] = [];
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "test-secret-test-secret-test-secret",
    database: refusingHeldIds(memoryAdapter(database)),
    logger: { log: (level, _message, ...args) => logged.push({ level, args }) },
    plugins: [
      sso({
        providersLimit: 0,
        defaultSSO: [samlConnection(idpInitiated)],
        saml: ssoSamlOptions,
        resolveUser: async () => ({ action: "continue" }),
      }),
    ],
  });
  return { auth, database, logged };
}

type Auth = ReturnType<typeof deployment>["auth"];

/** Starts sign-in as the page does and reads the request id the engine minted. */
async function startSignIn(auth: Auth) {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ providerId: PROVIDER_ID, callbackURL: "/", requestSignUp: true }),
    }),
  );
  expect(response.status).toBe(200);
  const redirect = new URL(startedSchema.parse(await response.json()).url);
  const request = inflateRawSync(
    Buffer.from(redirect.searchParams.get("SAMLRequest") ?? "", "base64"),
  ).toString("utf8");
  const requestId = /ID="([^"]+)"/.exec(request)?.[1] ?? "";
  expect(requestId).not.toBe("");
  return { requestId, relayState: redirect.searchParams.get("RelayState") ?? undefined };
}

function claims(over: Partial<SamlAssertionClaims> = {}): SamlAssertionClaims {
  return {
    issuer: IDP_ENTITY_ID,
    audience: SP_ENTITY_ID,
    recipient: ACS_URL,
    nameId: EMAIL,
    email: EMAIL,
    ...over,
  };
}

/** The identity provider's browser post to the assertion consumer address. */
async function postAssertion({
  auth,
  samlResponse,
  relayState,
  cookie,
}: {
  auth: Auth;
  samlResponse: string;
  relayState?: string;
  cookie?: string;
}) {
  const body = new URLSearchParams({ SAMLResponse: samlResponse });
  if (relayState !== undefined) body.set("RelayState", relayState);
  return auth.handler(
    new Request(ACS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE_URL,
        ...(cookie === undefined ? {} : { cookie }),
      },
      body,
      redirect: "manual",
    }),
  );
}

function outcomeOf(response: Response) {
  const location = response.headers.get("location");
  const url = location === null ? null : new URL(location, BASE_URL);
  return {
    status: response.status,
    error: url?.searchParams.get("error") ?? null,
    path: url?.pathname ?? null,
  };
}

const unsolicited = (over: Partial<SamlAssertionClaims> = {}) =>
  signSamlResponse({ identity: idp, claims: claims(over) });

afterEach(() => {
  vi.useRealTimers();
});

describe("given a SAML connection that is not opted in", () => {
  /** @scenario "An unsolicited response for a connection not opted in is refused" */
  it("refuses a valid unsolicited response, signs nobody in and logs the connection", async () => {
    const { auth, database, logged } = deployment(OFF);

    const outcome = outcomeOf(await postAssertion({ auth, samlResponse: unsolicited() }));

    expect(outcome).toMatchObject({ status: 302, error: "unsolicited_response" });
    expect(database.session).toEqual([]);
    expect(logged).toContainEqual({
      level: "error",
      args: [expect.objectContaining({ providerId: PROVIDER_ID })],
    });
  });

  /** @scenario "A connection is not opted in until somebody opts it in" */
  it("reads a document written before the setting as off, and refuses unsolicited responses", async () => {
    const older = { entryPoint: "https://idp.acme.test/sso", entityId: null, metadataXml: null };
    const { auth, database } = deployment(undefined);

    const outcome = outcomeOf(await postAssertion({ auth, samlResponse: unsolicited() }));

    expect(ssoSamlIdpConfigSchema.parse({ ...older, certificate: null }).idpInitiated).toEqual(OFF);
    expect(outcome).toMatchObject({ status: 302, error: "unsolicited_response" });
    expect(database.session).toEqual([]);
  });

  /** @scenario "A sign-in LangWatch started is unaffected by the opt-in" */
  it("still signs in a person whose sign-in LangWatch started", async () => {
    const { auth, database } = deployment(OFF);
    const { requestId, relayState } = await startSignIn(auth);

    const samlResponse = unsolicited({ inResponseTo: requestId });
    const outcome = outcomeOf(await postAssertion({ auth, samlResponse, relayState }));

    expect(outcome).toMatchObject({ status: 302, error: null });
    expect(database.session).toHaveLength(1);
  });
});

describe("given a SAML connection opted in with /acme/messages listed", () => {
  /** @scenario "An unsolicited response for an opted-in connection signs the person in" */
  /** @scenario "An unsolicited response with nobody signed in signs the person in" */
  it("signs the person in through the connection", async () => {
    const { auth, database } = deployment(OPTED_IN);

    const outcome = outcomeOf(await postAssertion({ auth, samlResponse: unsolicited() }));

    expect(outcome).toMatchObject({ status: 302, error: null, path: "/" });
    expect(database.session).toHaveLength(1);
    const accounts: { providerId: string }[] = database.account;
    expect(accounts).toEqual([expect.objectContaining({ providerId: PROVIDER_ID })]);
  });

  /** @scenario "An unsolicited response for an opted-in connection signs the person in" */
  it.each([
    ["/acme/messages", "/acme/messages"],
    [`${BASE_URL}/acme/messages`, "/acme/messages"],
    ["/settings", "/"],
    ["https://elsewhere.example/acme/messages", "/"],
    ["//elsewhere.example/acme/messages", "/"],
  ])("lands RelayState %s on %s", async (relayState, path) => {
    const { auth } = deployment(OPTED_IN);

    const outcome = outcomeOf(
      await postAssertion({ auth, samlResponse: unsolicited(), relayState }),
    );

    expect(outcome).toMatchObject({ status: 302, error: null, path });
  });

  /** @scenario "A replayed assertion is refused" */
  it("refuses the same assertion posted a second time", async () => {
    const { auth, database } = deployment(OPTED_IN);
    const samlResponse = unsolicited();

    const first = outcomeOf(await postAssertion({ auth, samlResponse }));
    const second = outcomeOf(await postAssertion({ auth, samlResponse }));

    expect(first.error).toBeNull();
    expect(second).toMatchObject({ status: 302, error: "replay_detected" });
    expect(database.session).toHaveLength(1);
  });

  type Fault = { claims?: Partial<SamlAssertionClaims>; signer?: SigningIdentity; later?: number };

  /** The refusal one response gets, solicited or not, with one check made to fail. */
  async function refusalFor({ fault, solicited }: { fault: Fault; solicited: boolean }) {
    const { auth, database } = deployment(OPTED_IN);
    const started = solicited ? await startSignIn(auth) : undefined;
    const samlResponse = signSamlResponse({
      identity: fault.signer ?? idp,
      claims: claims({ inResponseTo: started?.requestId, ...fault.claims }),
    });
    if (fault.later !== undefined) {
      vi.useFakeTimers({ now: Date.now() + fault.later, toFake: ["Date"] });
    }
    const response = await postAssertion({ auth, samlResponse, relayState: started?.relayState });
    vi.useRealTimers();
    expect(database.session).toEqual([]);
    const { status, error } = outcomeOf(response);
    return { status, error };
  }

  /** @scenario "An unsolicited response that fails a response check is refused" */
  it.each<[string, Fault]>([
    ["audience", { claims: { audience: "https://elsewhere.example/sp" } }],
    ["recipient", { claims: { recipient: `${BASE_URL}/api/auth/sso/saml2/sp/acs/other` } }],
    ["destination", { claims: { recipient: "https://elsewhere.example/acs" } }],
    ["signature", { signer: stranger }],
    ["expiry, beyond the allowed clock difference", { later: 24 * 60 * 60 * 1000 }],
  ])("refuses a wrong %s as a sign-in LangWatch started is refused", async (_check, fault) => {
    const asked = await refusalFor({ fault, solicited: true });
    const unasked = await refusalFor({ fault, solicited: false });

    expect(asked.error !== null || asked.status >= 400).toBe(true);
    expect(unasked).toEqual(asked);
  });
});

describe("given a SAML connection opted in, and a browser already signed in as carol", () => {
  /** Signs carol in through an unsolicited response and returns the browser's cookies. */
  async function signedInAsCarol(auth: Auth) {
    const response = await postAssertion({ auth, samlResponse: unsolicited() });
    expect(outcomeOf(response)).toMatchObject({ status: 302, error: null });
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }

  /** @scenario "An unsolicited response for another person is refused while somebody is signed in" */
  it("refuses a response for dave, keeps carol's session and mints none", async () => {
    const { auth, database, logged } = deployment(OPTED_IN);
    const cookie = await signedInAsCarol(auth);
    const sessionsBefore = [...database.session];

    const response = await postAssertion({
      auth,
      samlResponse: unsolicited({ nameId: OTHER_EMAIL, email: OTHER_EMAIL }),
      cookie,
    });

    expect(outcomeOf(response)).toMatchObject({ status: 302, error: "signed_in_as_another_user" });
    expect(response.headers.get("set-cookie") ?? "").not.toContain("session_token=");
    expect(database.session).toEqual(sessionsBefore);
    expect(logged).toContainEqual({ level: "warn", args: [{ providerId: PROVIDER_ID }] });
  });

  /** @scenario "An unsolicited response for the person already signed in signs them in" */
  it("signs carol in again", async () => {
    const { auth, database } = deployment(OPTED_IN);
    const cookie = await signedInAsCarol(auth);

    const outcome = outcomeOf(await postAssertion({ auth, samlResponse: unsolicited(), cookie }));

    expect(outcome).toMatchObject({ status: 302, error: null });
    expect(database.session).toHaveLength(2);
  });
});

describe("given a SAML connection opted in, and an identity provider whose clock is off", () => {
  // The signer opens the window a minute before its clock and closes it five minutes after.
  /** @scenario "A SAML assertion whose <boundary> is <gap> <side> our clock is <outcome>" */
  it.each([
    { window: "NotBefore is 90 seconds ahead of", clockSkewSeconds: 150, error: null },
    { window: "NotBefore is 180 seconds ahead of", clockSkewSeconds: 240, error: "saml_error" },
    { window: "NotOnOrAfter is 90 seconds behind", clockSkewSeconds: -390, error: null },
    { window: "NotOnOrAfter is 180 seconds behind", clockSkewSeconds: -480, error: "saml_error" },
  ])("answers an assertion whose $window our clock", async ({ clockSkewSeconds, error }) => {
    const { auth, database } = deployment(OPTED_IN);
    const samlResponse = signSamlResponse({ identity: idp, claims: claims(), clockSkewSeconds });

    const outcome = outcomeOf(await postAssertion({ auth, samlResponse }));

    expect(outcome).toMatchObject({ status: 302, error });
    expect(database.session).toHaveLength(error === null ? 1 : 0);
  });
});
