export function parseSummedNanoUsd(value: unknown): number {
  const parsed = BigInt(String(value ?? 0));

  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < 0n) {
    throw new Error(`Summed nano-USD value ${parsed} exceeds the safe integer range`);
  }

  return Number(parsed);
}
