/**
 * ADR-092 §12 — permission bitsets. The registry is a fixed, append-only
 * ordered list, so an effective permission set is a few dozen bytes and a
 * membership test is a bit test. Used by passports; client-safe.
 */
import { ALL_PERMISSIONS, permissionIndex } from "./registry";

export function encodePermissionBitset(
  permissions: Iterable<string>,
): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(ALL_PERMISSIONS.length / 8));
  for (const permission of permissions) {
    const index = permissionIndex(permission);
    if (index === undefined) continue;
    bytes[Math.floor(index / 8)]! |= 1 << (index % 8);
  }
  return bytes;
}

export function bitsetHasPermission({
  bitset,
  permission,
}: {
  bitset: Uint8Array;
  permission: string;
}): boolean {
  const index = permissionIndex(permission);
  if (index === undefined) return false;
  const byte = bitset[Math.floor(index / 8)];
  if (byte === undefined) return false;
  return (byte & (1 << (index % 8))) !== 0;
}

export function bitsetToBase64Url(bitset: Uint8Array): string {
  return Buffer.from(bitset).toString("base64url");
}

export function bitsetFromBase64Url(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64url"));
}
