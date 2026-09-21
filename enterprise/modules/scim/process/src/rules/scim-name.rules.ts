// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The two halves a patch named. Both absent means the patch named no name. */
export interface ScimNameParts {
  givenName?: string;
  familyName?: string;
}

/** Whether a patch moved the stored name, and what it moved to. */
export type MergedScimName = { changed: false } | { changed: true; name: string };

/**
 * A display name, patched one half at a time. SCIM carries `givenName` and
 * `familyName`; this product stores one string, and a directory patching only
 * the surname must not throw the forename away. ADR-002.
 */
export function mergeNameParts({
  current,
  givenName,
  familyName,
}: ScimNameParts & { current: string }): MergedScimName {
  const hasGiven = typeof givenName === "string" && givenName.length > 0;
  const hasFamily = typeof familyName === "string" && familyName.length > 0;
  if (!hasGiven && !hasFamily) return { changed: false };

  const stored = current.trim();
  const firstSpace = stored.indexOf(" ");
  const currentGiven = firstSpace === -1 ? stored : stored.slice(0, firstSpace);
  const currentFamily = firstSpace === -1 ? "" : stored.slice(firstSpace + 1).trim();

  const nextGiven = hasGiven ? givenName.trim() : currentGiven;
  const nextFamily = hasFamily ? familyName.trim() : currentFamily;

  const merged = [nextGiven, nextFamily].filter((part) => part.length > 0);
  return merged.length > 0 ? { changed: true, name: merged.join(" ") } : { changed: false };
}

/** Whether either half is present, which is what makes a patch a name patch. */
export function namesAName(parts: ScimNameParts): boolean {
  return parts.givenName !== void 0 || parts.familyName !== void 0;
}

/**
 * The name parts a PATCH names, in whichever of the three legitimate SCIM
 * spellings arrived — nested object, dotted keys, or a dotted path with a
 * scalar value. The third is what Okta and Entra send. ADR-002.
 */
export function namePartsIn({
  path,
  value,
}: {
  path: string | undefined;
  value: unknown;
}): ScimNameParts {
  const scalar = typeof value === "string" ? value : void 0;
  if (path === "name.givenName" && scalar !== void 0) {
    return { givenName: scalar };
  }
  if (path === "name.familyName" && scalar !== void 0) {
    return { familyName: scalar };
  }

  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;

  // `{path: "name", value: {givenName, familyName}}`: the parts arrive
  // UNWRAPPED, because the path already said which attribute they belong to.
  if (path === "name") return partsAt(record, "givenName", "familyName");

  const nested = record.name;
  if (nested && typeof nested === "object") {
    return partsAt(nested as Record<string, unknown>, "givenName", "familyName");
  }

  return partsAt(record, "name.givenName", "name.familyName");
}

/** The two halves read off one record under whichever keys carry them. */
function partsAt(
  source: Record<string, unknown>,
  givenKey: string,
  familyKey: string,
): ScimNameParts {
  const given = source[givenKey];
  const family = source[familyKey];
  return {
    ...(typeof given === "string" ? { givenName: given } : {}),
    ...(typeof family === "string" ? { familyName: family } : {}),
  };
}
