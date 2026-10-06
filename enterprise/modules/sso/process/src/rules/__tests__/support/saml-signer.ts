// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A stand-in SAML identity provider's signing half, for tests only.
 *
 * Every certificate is generated when the test runs (a fresh RSA key and a
 * self-signed X.509 built from node:crypto alone), so no private key is ever
 * committed. The assertion is written already in exclusive canonical form, so
 * the digest and signature here are over exactly what a verifier canonicalises.
 */
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  X509Certificate,
} from "node:crypto";

export interface SigningIdentity {
  /** The certificate, PEM-armoured, as an administrator pastes it. */
  certificatePem: string;
  /** The certificate body without armour, as metadata carries it. */
  certificateBase64: string;
  privateKeyPem: string;
}

const OID_SHA256_WITH_RSA = "2a864886f70d01010b";
const OID_COMMON_NAME = "550403";

function derLength(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  if (size < 0x100) return Buffer.from([0x81, size]);
  return Buffer.from([0x82, size >> 8, size & 0xff]);
}

function der(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]) => der(0x31, Buffer.concat(parts));
const oid = (hex: string) => der(0x06, Buffer.from(hex, "hex"));
const utf8 = (text: string) => der(0x0c, Buffer.from(text, "utf8"));
const utcTime = (date: Date) =>
  der(0x17, Buffer.from(date.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z", "ascii"));

function name(commonName: string): Buffer {
  return sequence(set(sequence(oid(OID_COMMON_NAME), utf8(commonName))));
}

function pem(label: string, body: Buffer): string {
  const lines = body.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** A fresh key and a self-signed certificate for it. */
export function createSigningIdentity({
  commonName = "idp.test.langwatch.invalid",
}: { commonName?: string } = {}): SigningIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const algorithm = sequence(oid(OID_SHA256_WITH_RSA), der(0x05, Buffer.alloc(0)));
  const now = Date.now();
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.concat([Buffer.from([0x01]), randomBytes(8)])),
    algorithm,
    name(commonName),
    sequence(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 86_400_000 * 365))),
    name(commonName),
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = createSign("RSA-SHA256").update(tbs).sign(privateKey);
  const certificate = sequence(
    tbs,
    algorithm,
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const certificatePem = pem("CERTIFICATE", certificate);
  // Parsing it back is the proof the hand-built DER is a certificate at all.
  new X509Certificate(certificatePem);
  return {
    certificatePem,
    certificateBase64: certificate.toString("base64"),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const NS_PROTOCOL = "urn:oasis:names:tc:SAML:2.0:protocol";
const NS_ASSERTION = "urn:oasis:names:tc:SAML:2.0:assertion";
const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
const ALG_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ALG_RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const ALG_SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const ALG_ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', "&quot;");

export interface SamlAssertionClaims {
  /** The identity provider's entity id, the assertion's Issuer. */
  issuer: string;
  /** Who the assertion is for: the service provider's entity id. */
  audience: string;
  /** The assertion consumer service URL the response is delivered to. */
  recipient: string;
  nameId: string;
  email: string;
  assertionId?: string;
  /** The id of the sign-in request this answers; unsolicited when absent. */
  inResponseTo?: string;
}

function assertionBody({
  claims,
  issueInstant,
  expiry,
}: {
  claims: SamlAssertionClaims;
  issueInstant: string;
  expiry: string;
}) {
  const q = escapeAttribute;
  const t = escapeText;
  return (
    `<saml:Issuer>${t(claims.issuer)}</saml:Issuer>` +
    "@@SIGNATURE@@" +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${t(claims.nameId)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${claims.inResponseTo ? ` InResponseTo="${q(claims.inResponseTo)}"` : ""} NotOnOrAfter="${expiry}" Recipient="${q(claims.recipient)}"></saml:SubjectConfirmationData></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${new Date(Date.parse(issueInstant) - 60_000).toISOString()}" NotOnOrAfter="${expiry}"><saml:AudienceRestriction><saml:Audience>${t(claims.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${issueInstant}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${t(claims.email)}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>`
  );
}

/**
 * A SAML Response whose single Assertion is signed by `identity`, base64
 * encoded the way a browser posts it. Sign with one identity and hand a
 * connection another to get an assertion nobody configured; edit the result
 * with `tamperWithAssertion` to get one altered after signing.
 */
export function signSamlResponse({
  identity,
  claims,
  now = new Date(),
}: {
  identity: SigningIdentity;
  claims: SamlAssertionClaims;
  now?: Date;
}): string {
  const issueInstant = now.toISOString();
  const expiry = new Date(now.getTime() + 5 * 60_000).toISOString();
  const assertionId = claims.assertionId ?? `_${randomUUID()}`;
  const assertionOpen = `<saml:Assertion xmlns:saml="${NS_ASSERTION}" ID="${assertionId}" IssueInstant="${issueInstant}" Version="2.0">`;
  const body = assertionBody({ claims, issueInstant, expiry });

  // The digest covers the assertion as it stands without its own Signature.
  const unsigned = `${assertionOpen}${body.replace("@@SIGNATURE@@", "")}</saml:Assertion>`;
  const digest = createHash("sha256").update(unsigned).digest("base64");
  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${NS_DSIG}"><ds:CanonicalizationMethod Algorithm="${ALG_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALG_RSA_SHA256}"></ds:SignatureMethod>` +
    `<ds:Reference URI="#${assertionId}"><ds:Transforms><ds:Transform Algorithm="${ALG_ENVELOPED}"></ds:Transform><ds:Transform Algorithm="${ALG_C14N}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"></ds:DigestMethod><ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
  const signatureValue = createSign("RSA-SHA256")
    .update(signedInfo)
    .sign(identity.privateKeyPem, "base64");
  const signature =
    `<ds:Signature xmlns:ds="${NS_DSIG}">${signedInfo}<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${identity.certificateBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature>`;

  const response =
    `<samlp:Response xmlns:samlp="${NS_PROTOCOL}" Destination="${escapeAttribute(claims.recipient)}" ID="_${randomUUID()}"${claims.inResponseTo ? ` InResponseTo="${escapeAttribute(claims.inResponseTo)}"` : ""} IssueInstant="${issueInstant}" Version="2.0">` +
    `<saml:Issuer xmlns:saml="${NS_ASSERTION}">${escapeText(claims.issuer)}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"></samlp:StatusCode></samlp:Status>` +
    `${assertionOpen}${body.replace("@@SIGNATURE@@", signature)}</saml:Assertion></samlp:Response>`;
  return Buffer.from(response, "utf8").toString("base64");
}

/** Changes a signed response's text after signing, leaving the signature as it was. */
export function tamperWithAssertion({
  signedResponse,
  replace,
  with: replacement,
}: {
  signedResponse: string;
  replace: string;
  with: string;
}): string {
  const xml = Buffer.from(signedResponse, "base64").toString("utf8");
  if (!xml.includes(replace)) throw new Error(`the signed response does not contain ${replace}`);
  return Buffer.from(xml.replace(replace, replacement), "utf8").toString("base64");
}

/** Identity provider metadata naming each certificate as a signing key. */
export function idpMetadata({
  entityId,
  singleSignOnUrl,
  identities,
}: {
  entityId: string;
  singleSignOnUrl: string;
  identities: SigningIdentity[];
}): string {
  const keys = identities
    .map(
      ({ certificateBase64 }) =>
        `<KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="${NS_DSIG}"><ds:X509Data><ds:X509Certificate>${certificateBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></KeyDescriptor>`,
    )
    .join("");
  return (
    `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeAttribute(entityId)}">` +
    `<IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="${NS_PROTOCOL}">${keys}` +
    `<NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>` +
    `<SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapeAttribute(singleSignOnUrl)}"/>` +
    `</IDPSSODescriptor></EntityDescriptor>`
  );
}
