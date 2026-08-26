function decodeBase64OpenTelemetryId(value: unknown): string | null {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value !== "string") return null;
  if (!/[+/=]/.test(value)) return value;
  try {
    return Buffer.from(value, "base64").toString("hex");
  } catch {
    return value;
  }
}

export class OtlpIdAdapter {
  private constructor() {}

  static create(): OtlpIdAdapter {
    return new OtlpIdAdapter();
  }
}

export { decodeBase64OpenTelemetryId };
