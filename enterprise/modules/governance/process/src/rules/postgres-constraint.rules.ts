// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

const UNIQUE_VIOLATION = "23505";

const PRISMA_UNIQUE_VIOLATION = "P2002";

function readField(error: object, field: string): unknown {
  return Object.getOwnPropertyDescriptor(error, field)?.value;
}

function hasSqlState(error: object, sqlState: string): boolean {
  if (readField(error, "code") === sqlState) return true;
  const meta = readField(error, "meta");
  if (typeof meta === "object" && meta !== null && readField(meta, "code") === sqlState) {
    return true;
  }
  const message = error instanceof Error ? error.message : readField(error, "message");
  return typeof message === "string" && new RegExp(`\\b${sqlState}\\b`).test(message);
}

/** A unique-index refusal, whichever layer reported it: the Prisma code, the SQLSTATE, or the text. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (readField(error, "code") === PRISMA_UNIQUE_VIOLATION) return true;
  return hasSqlState(error, UNIQUE_VIOLATION);
}
