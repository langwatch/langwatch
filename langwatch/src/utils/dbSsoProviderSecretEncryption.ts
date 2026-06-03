import type { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "./encryption";

/**
 * Transparent field encryption for SsoProvider secrets.
 *
 * The @better-auth/sso plugin stores protocol config as JSON strings in
 * `oidcConfig` (carries the OIDC client secret) and `samlConfig` (carries SAML
 * private keys). The plugin writes/reads these through the shared Prisma client
 * via better-auth's adapter, and it expects plaintext JSON on both sides — it
 * has no encryption of its own, so left alone it would persist client secrets
 * and signing keys in cleartext.
 *
 * This middleware encrypts those two columns on the way into the database and
 * decrypts them on the way out, for BOTH the plugin's adapter calls and
 * SsoProviderRepository. It is the single chokepoint that preserves LangWatch's
 * existing "secrets at rest are encrypted" posture without forking the plugin.
 *
 * Encrypt/decrypt are gated on the `iv:cipher:tag` hex shape produced by
 * encrypt(), so the middleware is idempotent (never double-encrypts) and
 * tolerant of plaintext rows (test fixtures, manual inserts) — a JSON string
 * never matches the ciphertext shape, so it passes through untouched on read.
 */

const ENCRYPTED_FIELDS = ["oidcConfig", "samlConfig"] as const;

// iv(hex) : ciphertext(hex) : authTag(hex) — see utils/encryption.ts
const CIPHERTEXT_SHAPE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;

const isCiphertext = (value: unknown): value is string =>
  typeof value === "string" && CIPHERTEXT_SHAPE.test(value);

const encryptField = (value: unknown): unknown => {
  if (typeof value === "string" && value.length > 0 && !isCiphertext(value)) {
    return encrypt(value);
  }
  // Prisma scalar update wrapper: { set: "<json>" }
  if (
    value &&
    typeof value === "object" &&
    "set" in value &&
    typeof (value as { set: unknown }).set === "string"
  ) {
    return { set: encryptField((value as { set: string }).set) };
  }
  return value;
};

const decryptField = (value: unknown): unknown =>
  isCiphertext(value) ? decrypt(value) : value;

const encryptPayload = (data: unknown): void => {
  if (!data || typeof data !== "object") return;
  for (const field of ENCRYPTED_FIELDS) {
    if (field in data) {
      (data as Record<string, unknown>)[field] = encryptField(
        (data as Record<string, unknown>)[field],
      );
    }
  }
};

const decryptRow = (row: unknown): void => {
  if (!row || typeof row !== "object") return;
  for (const field of ENCRYPTED_FIELDS) {
    if (field in row) {
      (row as Record<string, unknown>)[field] = decryptField(
        (row as Record<string, unknown>)[field],
      );
    }
  }
};

const decryptResult = (result: unknown): void => {
  if (Array.isArray(result)) {
    for (const row of result) decryptRow(row);
  } else {
    decryptRow(result);
  }
};

const _encryptInputs = (params: Prisma.MiddlewareParams): void => {
  const { action, args } = params;
  if (!args) return;

  if (action === "create" || action === "update" || action === "updateMany") {
    encryptPayload(args.data);
  } else if (action === "createMany") {
    const data = args.data;
    if (Array.isArray(data)) data.forEach(encryptPayload);
    else encryptPayload(data);
  } else if (action === "upsert") {
    encryptPayload(args.create);
    encryptPayload(args.update);
  }
};

const RESULT_DECRYPTING_ACTIONS = new Set<Prisma.PrismaAction>([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "create",
  "update",
  "upsert",
]);

export const encryptSsoProviderSecrets: Prisma.Middleware = async (
  params,
  next,
) => {
  if (params.model !== "SsoProvider") return next(params);

  _encryptInputs(params);
  const result = await next(params);

  if (RESULT_DECRYPTING_ACTIONS.has(params.action)) decryptResult(result);

  return result;
};
