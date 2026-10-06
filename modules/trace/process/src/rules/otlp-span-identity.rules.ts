import type { Fixed64 } from "@opentelemetry/otlp-transformer-next/build/esm/common/internal-types.js";

export const normalizeOtlpId = (id: string | Uint8Array): string => {
  if (id instanceof Uint8Array) {
    return Buffer.from(id).toString("hex");
  }

  return id;
};

export const normalizeOtlpUnixNano = (value: Fixed64): number => {
  if (typeof value === "string") {
    return parseInt(value, 10);
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "object" && "high" in value && "low" in value) {
    const { high, low } = value;

    if (typeof high === "number" && typeof low === "number") {
      const bigIntValue = Number((BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn));

      return bigIntValue;
    }
  }

  throw new Error(`Invalid Unix nano value: ${JSON.stringify(value)}`);
};

export const convertUnixNanoToUnixMs = (unixNano: number): number => {
  return Math.round(unixNano / 1_000_000);
};
