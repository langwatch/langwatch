// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** How a SCIM bearer token is stored and looked up, as main derived it (ADR-132 for the pepper). */
import { createHash, createHmac } from "node:crypto";

export type ScimTokenHashScheme = "sha256" | "hmac-sha256";

/** The shortest token an administrator may choose: what a minted one is worth in characters. */
export const MINIMUM_SCIM_TOKEN_LENGTH = 32;

export function digestScimToken({
  token,
  scheme,
  pepper,
}: {
  token: string;
  scheme: ScimTokenHashScheme;
  pepper: string;
}): string {
  if (scheme === "sha256") {
    return createHash("sha256").update(token).digest("hex");
  }
  return createHmac("sha256", pepper).update(token).digest("hex");
}

/** Both digests a presented token may be stored under: new rows HMAC, older rows bare sha256. */
export function scimTokenDigests({ token, pepper }: { token: string; pepper: string }): string[] {
  return [
    digestScimToken({ token, scheme: "hmac-sha256", pepper }),
    digestScimToken({ token, scheme: "sha256", pepper }),
  ];
}
