import crypto from "node:crypto";

import {
  DEFAULT_LICENSE_PUBLIC_KEY,
  LICENSE_ERRORS,
  LicenseKeyInvalidError,
  LicenseSigningFailedError,
  LicenseSigningKeyEncryptedError,
  LicenseSigningKeyNotPemError,
  SignedLicenseSchema,
  mapToPlanInfo,
  type LicenseData,
  type SignedLicense,
  type ValidationResult,
} from "@langwatch/enterprise-licensing-contract";
import { LICENSE_TOKEN_PREFIX } from "@langwatch/gateway-contract";
import { nowInstant, toEpochMs, type Instant } from "@langwatch/time";

import { type LicenseCryptography } from "../app/licensing.members.ts";

/**
 * PEM normalization for license signing keys. OpenSSL is unforgiving about
 * layout; copy/pasted keys are re-emitted in canonical form.
 */

/** Matches a PEM block, capturing the label (`PRIVATE KEY`, `RSA PRIVATE KEY`, …) and its body. */
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/;

/**
 * Matches private-key blocks only. PEM files can be bundles; this finds the
 * private key instead of any certificate that might precede it.
 */
const PEM_PRIVATE_KEY_BLOCK =
  /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;

/** RFC 1421 headers (`Proc-Type:`, `DEK-Info:`) precede the body of legacy encrypted keys. */
const PEM_HEADER_LINE = /^[A-Za-z][A-Za-z0-9-]*:\s/m;

/** RFC 7468 wraps the base64 body at 64 characters. */
const PEM_BODY_LINE = /.{1,64}/g;

export type NodeLicenseCryptographyAdapterOptions = {
  publicKey?: string;
};

/** Node RSA implementation. It owns no environment lookup or global state. */
export class NodeLicenseCryptographyAdapter implements LicenseCryptography {
  private constructor(private readonly publicKey: string) {}

  static create(
    options: NodeLicenseCryptographyAdapterOptions = {},
  ): NodeLicenseCryptographyAdapter {
    return new NodeLicenseCryptographyAdapter(options.publicKey ?? DEFAULT_LICENSE_PUBLIC_KEY);
  }

  /**
   * Rewrites a PEM key into canonical form: no leading/trailing whitespace,
   * no indentation, body wrapped at 64 characters, and LF line endings.
   */
  static normalizePemKey(raw: string): string {
    const unescaped = raw.replace(/^﻿/, "").replace(/\\r\\n|\\n/g, "\n");
    const match = PEM_PRIVATE_KEY_BLOCK.exec(unescaped) ?? PEM_BLOCK.exec(unescaped);
    if (!match) return NodeLicenseCryptographyAdapter.dedent(unescaped);

    const [, label, body = ""] = match;
    if (PEM_HEADER_LINE.test(NodeLicenseCryptographyAdapter.dedent(body))) {
      return NodeLicenseCryptographyAdapter.dedent(unescaped);
    }

    const base64 = body.replace(/\s+/g, "");
    const lines = base64.match(PEM_BODY_LINE) ?? [];
    return [`-----BEGIN ${label!}-----`, ...lines, `-----END ${label!}-----`, ""].join("\n");
  }

  /** True when the key is passphrase-protected. */
  static isEncryptedPemKey(raw: string): boolean {
    const normalized = NodeLicenseCryptographyAdapter.normalizePemKey(raw);
    return (
      normalized.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----") ||
      PEM_HEADER_LINE.test(normalized)
    );
  }

  /** True when the input contains a PEM block at all. */
  static looksLikePemKey(raw: string): boolean {
    return PEM_BLOCK.test(NodeLicenseCryptographyAdapter.normalizePemKey(raw));
  }

  private static dedent(value: string): string {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join("\n")
      .trim();
  }

  parseLicenseKey(licenseKey: string): SignedLicense | null {
    if (!licenseKey || licenseKey.trim() === "") return null;

    try {
      const decoded = Buffer.from(licenseKey, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded) as unknown;
      const result = SignedLicenseSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  verifySignature(signedLicense: SignedLicense, publicKey = this.publicKey): boolean {
    if (!signedLicense.signature || signedLicense.signature.trim() === "") {
      return false;
    }

    try {
      const verify = crypto.createVerify("SHA256");
      verify.update(JSON.stringify(signedLicense.data));
      verify.end();
      return verify.verify(
        NodeLicenseCryptographyAdapter.normalizePemKey(publicKey),
        signedLicense.signature,
        "base64",
      );
    } catch {
      return false;
    }
  }

  isExpired(expiresAt: string, now = nowInstant()): boolean {
    const expirationMs = toEpochMs(expiresAt);
    return Number.isNaN(expirationMs) || now.epochMilliseconds >= expirationMs;
  }

  validateLicense({
    licenseKey,
    publicKey = this.publicKey,
    now = nowInstant(),
  }: {
    licenseKey: string;
    publicKey?: string;
    now?: Instant;
  }): ValidationResult {
    const signedLicense = this.parseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { valid: false, error: LICENSE_ERRORS.INVALID_FORMAT };
    }
    if (!this.verifySignature(signedLicense, publicKey)) {
      return { valid: false, error: LICENSE_ERRORS.INVALID_SIGNATURE };
    }
    if (this.isExpired(signedLicense.data.expiresAt, now)) {
      return { valid: false, error: LICENSE_ERRORS.EXPIRED };
    }
    return {
      valid: true,
      licenseData: signedLicense.data,
      planInfo: mapToPlanInfo(signedLicense.data),
    };
  }

  signLicense(data: LicenseData, privateKey: string): SignedLicense {
    const normalizedKey = NodeLicenseCryptographyAdapter.normalizePemKey(privateKey);
    if (!NodeLicenseCryptographyAdapter.looksLikePemKey(normalizedKey)) {
      throw new LicenseSigningKeyNotPemError();
    }
    if (NodeLicenseCryptographyAdapter.isEncryptedPemKey(normalizedKey)) {
      throw new LicenseSigningKeyEncryptedError();
    }

    const sign = crypto.createSign("SHA256");
    sign.update(JSON.stringify(data));
    sign.end();
    try {
      return { data, signature: sign.sign(normalizedKey, "base64") };
    } catch (error) {
      throw new LicenseSigningFailedError({
        reasons: error instanceof Error ? [error] : [],
      });
    }
  }

  encodeLicenseKey(signedLicense: SignedLicense): string {
    return Buffer.from(JSON.stringify(signedLicense), "utf-8").toString("base64");
  }

  generateLicenseId(): string {
    return `lic-${crypto.randomUUID()}`;
  }

  /** ADR-156 section 6: a bare UUID, because it is what an install presents. */
  generateInstanceId(): string {
    return crypto.randomUUID();
  }

  /**
   * The token is the SHA-256 of the canonical license: the parsed
   * `{data, signature}` re-serialized, which is what `verifySignature` judges,
   * so an install and Cloud derive the same token from the same paste.
   */
  getLicenseToken(licenseKey: string): string {
    // Base64 decoding skips line breaks, but not the spaces a copied license
    // picks up at its ends.
    const signedLicense = this.parseLicenseKey(licenseKey.trim());
    if (!signedLicense) throw new LicenseKeyInvalidError();

    const canonical = JSON.stringify({
      data: signedLicense.data,
      signature: signedLicense.signature,
    });
    return `${LICENSE_TOKEN_PREFIX}${sha256Hex(canonical)}`;
  }
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
