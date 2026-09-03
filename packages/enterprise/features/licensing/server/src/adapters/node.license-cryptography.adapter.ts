import crypto from "node:crypto";
import {
  DEFAULT_LICENSE_PUBLIC_KEY,
  LICENSE_ERRORS,
  LicenseSigningFailedError,
  LicenseSigningKeyEncryptedError,
  LicenseSigningKeyNotPemError,
  SignedLicenseSchema,
  mapToPlanInfo,
  type LicenseData,
  type SignedLicense,
  type ValidationResult,
} from "@langwatch/enterprise-licensing-contract";
import { LicenseCryptographyPort } from "../ports/license-cryptography.port";

/**
 * PEM normalization for license signing keys.
 *
 * OpenSSL's PEM reader is unforgiving about layout: it wants `-----BEGIN X-----`
 * at the start of a line and the base64 body on its own lines. A key that has
 * been through a copy/paste — a chat message, a code block, a YAML value, a
 * `.env` one-liner — arrives indented, space-prefixed or with its newlines
 * collapsed, and signing fails with an opaque `ERR_OSSL_UNSUPPORTED`.
 *
 * Only the base64 payload carries meaning, so we re-emit the block in canonical
 * form and let the layout of the paste be irrelevant.
 */

/** Matches a PEM block, capturing the label (`PRIVATE KEY`, `RSA PRIVATE KEY`, …) and its body. */
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/;

/**
 * The same, restricted to a private-key block (`PRIVATE KEY`, `RSA PRIVATE
 * KEY`, `EC PRIVATE KEY`, `ENCRYPTED PRIVATE KEY`).
 *
 * Preferred over the first block in the input, because a PEM file is legally a
 * *bundle*: operators keep a certificate or the public half in the same file,
 * often ahead of the private key. OpenSSL scans a bundle for the key it needs
 * and signs happily; canonicalizing whichever block came first would hand it
 * the certificate alone and break a key that worked before.
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
export class NodeLicenseCryptographyAdapter extends LicenseCryptographyPort {
  private constructor(private readonly publicKey: string) {
    super();
  }

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

  tryParseLicenseKey(licenseKey: string): SignedLicense | null {
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

  isExpired(expiresAt: string, now = new Date()): boolean {
    const expirationDate = new Date(expiresAt);
    return Number.isNaN(expirationDate.getTime()) || now >= expirationDate;
  }

  validateLicense({
    licenseKey,
    publicKey = this.publicKey,
    now = new Date(),
  }: {
    licenseKey: string;
    publicKey?: string;
    now?: Date;
  }): ValidationResult {
    const signedLicense = this.tryParseLicenseKey(licenseKey);
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
}
