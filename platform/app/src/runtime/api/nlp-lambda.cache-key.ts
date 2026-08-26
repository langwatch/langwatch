import crypto from "node:crypto";

export function createStudioNlpCacheKey(input: {
  projectId: string;
  salt: string | undefined;
  now: Date;
}): string | undefined {
  if (!input.salt) {
    return undefined;
  }

  const yearMonth = input.now.toISOString().slice(0, 7);
  return crypto
    .createHash("sha256")
    .update(`${input.projectId}-${input.salt}-${yearMonth}`)
    .digest("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 16)
    .toLowerCase();
}
