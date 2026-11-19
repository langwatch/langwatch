import type { Named } from "@langwatch/module";
/**
 * Private model endpoints (ADR-203): staff register the addresses, organizations bind hostnames.
 * The wire shape below is the one contract every TS caller sends to nlpgo and the AI gateway.
 */
import { nowEpochMs } from "@langwatch/time";
import { z } from "zod";

/**
 * The header nlpgo reads an organization's bindings from, on every route: `/go/proxy/v1` and the
 * workflow routes alike. Its value is a signed envelope ({@link signPrivateEndpointsHeaders}).
 */
export const PRIVATE_ENDPOINTS_HEADER = "X-LangWatch-Private-Endpoints";

/** The project a call runs for, sent next to the bindings; nlpgo checks the envelope against it. */
export const PRIVATE_ENDPOINTS_PROJECT_HEADER = "X-LangWatch-Project-Id";

/** The field the gateway config bundle carries bindings in. nlpgo never reads it. */
export const PRIVATE_ENDPOINTS_FIELD = "private_endpoints";

/** Where the app reads its Ed25519 signing key for bindings: base64 of the 32-byte seed. */
export const PRIVATE_ENDPOINTS_SIGNING_KEY_ENV = "LANGWATCH_PRIVATE_ENDPOINTS_SIGNING_KEY";

/** Where nlpgo reads the matching public key: base64 of the 32 raw bytes. */
export const PRIVATE_ENDPOINTS_VERIFY_KEY_ENV = "LANGWATCH_PRIVATE_ENDPOINTS_VERIFY_KEY";

/**
 * How long a signed envelope is honoured. nlpgo checks it once, when the request arrives, and a
 * run keeps the bindings it was admitted with; so this covers the wait between signing and the
 * engine reading the request (staging, a cold Lambda), not the run itself.
 */
export const PRIVATE_ENDPOINTS_TTL_SECONDS = 15 * 60;

/** One bound hostname: lowercased, no trailing dot, dialled at `addresses` on `port`. */
const privateEndpointBindingWireSchemaDefinition = z.object({
  hostname: z.string(),
  addresses: z.array(z.string()),
  port: z.number().int(),
});
export interface PrivateEndpointBindingWireSchema extends Named<
  typeof privateEndpointBindingWireSchemaDefinition
> {}
export const privateEndpointBindingWireSchema: PrivateEndpointBindingWireSchema =
  privateEndpointBindingWireSchemaDefinition;

export type PrivateEndpointBindingWire = z.infer<typeof privateEndpointBindingWireSchema>;

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The UTF-8 bytes of a string, with no platform encoder: this contract also loads in a browser. */
function utf8Of(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return bytes;
}

/** Base64url without padding (RFC 4648 §5) of raw bytes. */
function base64UrlOfBytes(bytes: ArrayLike<number>): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0;
    const b = bytes[at + 1] ?? 0;
    const c = bytes[at + 2] ?? 0;
    const chunk = (a << 16) | (b << 8) | c;
    const width = Math.min(3, bytes.length - at) + 1;
    for (let index = 0; index < width; index++) {
      out += BASE64URL[(chunk >> (18 - 6 * index)) & 63];
    }
  }
  return out;
}

const INVALID_SIGNING_KEY = `${PRIVATE_ENDPOINTS_SIGNING_KEY_ENV} must be base64 of a 32-byte Ed25519 private key seed.`;

/** The 32-byte seed in a signing key, base64 in either alphabet, padding optional; else throws. */
function getSigningSeed(text: string): Uint8Array {
  const clean = text.trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64URL.indexOf(char);
    if (value === -1) throw new Error(INVALID_SIGNING_KEY);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  if (out.length !== 32) throw new Error(INVALID_SIGNING_KEY);
  return Uint8Array.from(out);
}

/** The slice of WebCrypto the signer needs; Node 20+ and every current browser have it. */
type Ed25519Subtle = {
  importKey(
    format: "pkcs8",
    keyData: Uint8Array,
    algorithm: { name: "Ed25519" },
    extractable: false,
    usages: ["sign"],
  ): Promise<unknown>;
  sign(algorithm: { name: "Ed25519" }, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
};

function subtle(): Ed25519Subtle {
  const crypto = (globalThis as { crypto?: { subtle?: Ed25519Subtle } }).crypto;
  if (!crypto?.subtle) throw new Error("This runtime has no WebCrypto to sign bindings with.");
  return crypto.subtle;
}

/** The fixed PKCS#8 prefix of an Ed25519 private key (RFC 8410), before its 32-byte seed. */
const ED25519_PKCS8_PREFIX = [
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
];

const importedKeys = new Map<string, Promise<unknown>>();

/** The signing key, imported once per value. */
function signingKeyOf(seedBase64: string): Promise<unknown> {
  const cached = importedKeys.get(seedBase64);
  if (cached) return cached;
  const seed = getSigningSeed(seedBase64);
  const imported = subtle().importKey(
    "pkcs8",
    Uint8Array.from([...ED25519_PKCS8_PREFIX, ...seed]),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  importedKeys.set(seedBase64, imported);
  return imported;
}

/** What a signed envelope says: whose bindings, for which project, until when (Unix seconds). */
export type PrivateEndpointsEnvelope = {
  v: 1;
  organizationId: string;
  projectId: string;
  bindings: PrivateEndpointBindingWire[];
  expiresAt: number;
};

/** The headers a call to nlpgo carries the bindings in; empty when there are none to send. */
export type PrivateEndpointsHeaders = Readonly<Record<string, string>>;

/**
 * Signs an organization's bindings for one project's calls to nlpgo (ADR-203): headers to merge
 * into the request, empty when nothing is bound. Value: `base64url(JSON) "." base64url(Ed25519
 * signature of the first segment)`, checked by nlpgo with the public key.
 */
export async function signPrivateEndpointsHeaders(input: {
  organizationId: string;
  projectId: string;
  bindings: readonly PrivateEndpointBindingWire[];
  /** Base64 of the 32-byte Ed25519 seed, as {@link PRIVATE_ENDPOINTS_SIGNING_KEY_ENV} holds it. */
  signingKey: string;
  /** How long nlpgo honours it; {@link PRIVATE_ENDPOINTS_TTL_SECONDS} by default. */
  ttlSeconds?: number;
  /** Epoch milliseconds; tests fix it. */
  now?: number;
}): Promise<PrivateEndpointsHeaders> {
  if (input.bindings.length === 0) return {};
  const envelope: PrivateEndpointsEnvelope = {
    v: 1,
    organizationId: input.organizationId,
    projectId: input.projectId,
    bindings: input.bindings.map(toWire),
    expiresAt:
      Math.floor((input.now ?? nowEpochMs()) / 1000) +
      (input.ttlSeconds ?? PRIVATE_ENDPOINTS_TTL_SECONDS),
  };
  const payload = base64UrlOfBytes(utf8Of(JSON.stringify(envelope)));
  const signature = await subtle().sign(
    { name: "Ed25519" },
    await signingKeyOf(input.signingKey),
    Uint8Array.from(utf8Of(payload)),
  );
  return {
    [PRIVATE_ENDPOINTS_HEADER]: `${payload}.${base64UrlOfBytes(new Uint8Array(signature))}`,
    [PRIVATE_ENDPOINTS_PROJECT_HEADER]: input.projectId,
  };
}

/** The field to spread into the gateway config bundle; nothing when there is none. */
export function privateEndpointsField(bindings: readonly PrivateEndpointBindingWire[]): {
  private_endpoints?: PrivateEndpointBindingWire[];
} {
  if (bindings.length === 0) return {};
  return { private_endpoints: bindings.map(toWire) };
}

/** Exactly the three wire fields, the hostname normalised as the contract says. */
function toWire(binding: PrivateEndpointBindingWire): PrivateEndpointBindingWire {
  return {
    hostname: binding.hostname.trim().toLowerCase().replace(/\.$/, ""),
    addresses: [...binding.addresses],
    port: binding.port,
  };
}

// ── what organizations and staff read ────────────────────────────────────────

/** One hostname an organization bound, as its managers read it. */
const privateModelEndpointBindingSchemaDefinition = z.object({
  id: z.string(),
  endpointId: z.string(),
  hostname: z.string(),
});
export interface PrivateModelEndpointBindingSchema extends Named<
  typeof privateModelEndpointBindingSchemaDefinition
> {}
export const privateModelEndpointBindingSchema: PrivateModelEndpointBindingSchema =
  privateModelEndpointBindingSchemaDefinition;

export type PrivateModelEndpointBinding = z.infer<typeof privateModelEndpointBindingSchema>;

/** Whether any hostname reaches the endpoint yet. */
export const privateModelEndpointStatusSchema = z.enum(["in_use", "unbound"]);

export type PrivateModelEndpointStatus = z.infer<typeof privateModelEndpointStatusSchema>;

/** An endpoint as the organization reads it: never its addresses or port. */
const organizationPrivateModelEndpointSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  status: privateModelEndpointStatusSchema,
  bindings: z.array(privateModelEndpointBindingSchema),
});
export interface OrganizationPrivateModelEndpointSchema extends Named<
  typeof organizationPrivateModelEndpointSchemaDefinition
> {}
export const organizationPrivateModelEndpointSchema: OrganizationPrivateModelEndpointSchema =
  organizationPrivateModelEndpointSchemaDefinition;

export type OrganizationPrivateModelEndpoint = z.infer<
  typeof organizationPrivateModelEndpointSchema
>;

/** An endpoint as staff read it in ops, addresses included. */
const staffPrivateModelEndpointSchemaDefinition = z.object({
  ...organizationPrivateModelEndpointSchemaDefinition.shape,
  organizationId: z.string(),
  addresses: z.array(z.string()),
  port: z.number().int(),
});
export interface StaffPrivateModelEndpointSchema extends Named<
  typeof staffPrivateModelEndpointSchemaDefinition
> {}
export const staffPrivateModelEndpointSchema: StaffPrivateModelEndpointSchema =
  staffPrivateModelEndpointSchemaDefinition;

export type StaffPrivateModelEndpoint = z.infer<typeof staffPrivateModelEndpointSchema>;

// ── what organizations and staff send ────────────────────────────────────────

/** Strict: the binding API has no way to name an address, and an extra field is refused. */
const privateModelEndpointBindInputSchemaDefinition = z
  .object({ organizationId: z.string(), endpointId: z.string(), hostname: z.string() })
  .strict();
export interface PrivateModelEndpointBindInputSchema extends Named<
  typeof privateModelEndpointBindInputSchemaDefinition
> {}
export const privateModelEndpointBindInputSchema: PrivateModelEndpointBindInputSchema =
  privateModelEndpointBindInputSchemaDefinition;

export type PrivateModelEndpointBindInput = z.infer<typeof privateModelEndpointBindInputSchema>;

const privateModelEndpointRebindInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    bindingId: z.string(),
    endpointId: z.string(),
    hostname: z.string(),
  })
  .strict();
export interface PrivateModelEndpointRebindInputSchema extends Named<
  typeof privateModelEndpointRebindInputSchemaDefinition
> {}
export const privateModelEndpointRebindInputSchema: PrivateModelEndpointRebindInputSchema =
  privateModelEndpointRebindInputSchemaDefinition;

export type PrivateModelEndpointRebindInput = z.infer<typeof privateModelEndpointRebindInputSchema>;

const privateModelEndpointUnbindInputSchemaDefinition = z
  .object({ organizationId: z.string(), bindingId: z.string() })
  .strict();
export interface PrivateModelEndpointUnbindInputSchema extends Named<
  typeof privateModelEndpointUnbindInputSchemaDefinition
> {}
export const privateModelEndpointUnbindInputSchema: PrivateModelEndpointUnbindInputSchema =
  privateModelEndpointUnbindInputSchemaDefinition;

export type PrivateModelEndpointUnbindInput = z.infer<typeof privateModelEndpointUnbindInputSchema>;

const privateModelEndpointOrganizationInputSchemaDefinition = z
  .object({ organizationId: z.string() })
  .strict();
export interface PrivateModelEndpointOrganizationInputSchema extends Named<
  typeof privateModelEndpointOrganizationInputSchemaDefinition
> {}
export const privateModelEndpointOrganizationInputSchema: PrivateModelEndpointOrganizationInputSchema =
  privateModelEndpointOrganizationInputSchemaDefinition;

const privateModelEndpointRegisterInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    name: z.string(),
    region: z.string(),
    addresses: z.array(z.string()),
    port: z.number().int().default(443),
  })
  .strict();
export interface PrivateModelEndpointRegisterInputSchema extends Named<
  typeof privateModelEndpointRegisterInputSchemaDefinition
> {}
export const privateModelEndpointRegisterInputSchema: PrivateModelEndpointRegisterInputSchema =
  privateModelEndpointRegisterInputSchemaDefinition;

export type PrivateModelEndpointRegisterInput = z.infer<
  typeof privateModelEndpointRegisterInputSchema
>;

const privateModelEndpointUpdateInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    endpointId: z.string(),
    name: z.string(),
    region: z.string(),
    addresses: z.array(z.string()),
    port: z.number().int(),
  })
  .strict();
export interface PrivateModelEndpointUpdateInputSchema extends Named<
  typeof privateModelEndpointUpdateInputSchemaDefinition
> {}
export const privateModelEndpointUpdateInputSchema: PrivateModelEndpointUpdateInputSchema =
  privateModelEndpointUpdateInputSchemaDefinition;

export type PrivateModelEndpointUpdateInput = z.infer<typeof privateModelEndpointUpdateInputSchema>;

const privateModelEndpointRemoveInputSchemaDefinition = z
  .object({ organizationId: z.string(), endpointId: z.string() })
  .strict();
export interface PrivateModelEndpointRemoveInputSchema extends Named<
  typeof privateModelEndpointRemoveInputSchemaDefinition
> {}
export const privateModelEndpointRemoveInputSchema: PrivateModelEndpointRemoveInputSchema =
  privateModelEndpointRemoveInputSchemaDefinition;

export type PrivateModelEndpointRemoveInput = z.infer<typeof privateModelEndpointRemoveInputSchema>;
