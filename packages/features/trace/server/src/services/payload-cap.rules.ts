const DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES = 256 * 1024;

export function capPayloadString(
  value: string,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  label?: string,
): string {
  const byteSize = Buffer.byteLength(value, "utf8");

  if (byteSize <= maxBytes) {
    return value;
  }

  const labelPart = label ? ` ${label}` : "";
  const marker = `…[langwatch: truncated${labelPart}, ${byteSize} bytes total]`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  const head = Buffer.from(value, "utf8")
    .subarray(0, Math.max(0, maxBytes - markerBytes))
    .toString("utf8");

  return head + marker;
}
