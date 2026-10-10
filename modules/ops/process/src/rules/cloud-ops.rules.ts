import { createPublicKey } from "node:crypto";

import { CloudOpsKeyMismatchError } from "@langwatch/ops-contract";

const ESCAPED_NEWLINES = /\\r\\n|\\n/g;

/** The public half as DER, from a public or a private PEM; a value that does not parse refuses. */
function getPublicHalf(pem: string): string {
  try {
    return createPublicKey(pem.replace(ESCAPED_NEWLINES, "\n"))
      .export({ type: "spki", format: "der" })
      .toString("base64");
  } catch {
    throw new CloudOpsKeyMismatchError();
  }
}

/**
 * Cloud admin is on when asked for AND the private key present is the pair of the
 * release's built-in public key (asked for without one refuses boot), and always on a
 * developer's local stack, so the whole back office can be worked on.
 */
export function decideCloudOps({
  asked,
  isLocalDevelopment,
  privateKey,
  builtInPublicKey,
}: {
  asked: boolean;
  isLocalDevelopment: boolean;
  privateKey: string | undefined;
  builtInPublicKey: string;
}): boolean {
  if (!asked) return isLocalDevelopment;
  if (!privateKey || getPublicHalf(privateKey) !== getPublicHalf(builtInPublicKey)) {
    throw new CloudOpsKeyMismatchError();
  }
  return true;
}
