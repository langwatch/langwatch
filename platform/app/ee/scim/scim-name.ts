// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A display name, patched one half at a time.
 *
 * SCIM carries a name as `givenName` and `familyName`; we store one string.
 * A directory that patches only the surname therefore hands us half a name,
 * and the previous code rebuilt the whole thing from the half it was given —
 * so `{"name.familyName": "Smith"}` turned "Ada Lovelace" into "Smith" and
 * threw the forename away. Okta and Entra both patch one part at a time, so
 * this was not a corner.
 *
 * Splitting a stored string back into two halves is lossy by nature — a
 * person with two forenames or a two-word surname cannot be recovered
 * exactly. Splitting on the FIRST space is the inverse of the join that wrote
 * it (`[given, family].join(" ")`), so a name this product created round-trips
 * unchanged, and one it did not is at worst reassembled the way it was
 * already being displayed.
 */
export function mergeNameParts({
  current,
  givenName,
  familyName,
}: {
  current: string | null | undefined;
  givenName?: string | null;
  familyName?: string | null;
}): string | undefined {
  const hasGiven = typeof givenName === "string" && givenName.length > 0;
  const hasFamily = typeof familyName === "string" && familyName.length > 0;
  if (!hasGiven && !hasFamily) return undefined;

  const stored = (current ?? "").trim();
  const firstSpace = stored.indexOf(" ");
  const currentGiven = firstSpace === -1 ? stored : stored.slice(0, firstSpace);
  const currentFamily =
    firstSpace === -1 ? "" : stored.slice(firstSpace + 1).trim();

  const nextGiven = hasGiven ? givenName.trim() : currentGiven;
  const nextFamily = hasFamily ? familyName.trim() : currentFamily;

  const merged = [nextGiven, nextFamily].filter((part) => part.length > 0);
  return merged.length > 0 ? merged.join(" ") : undefined;
}

/**
 * The name parts a PATCH operation names, however it spells them.
 *
 * Three spellings reach us and all three are legitimate SCIM:
 *   - a nested object:  `{path: "name", value: {givenName, familyName}}`
 *   - dotted keys:      `{value: {"name.givenName": "Ada"}}`
 *   - a dotted PATH with a scalar value: `{path: "name.familyName", value: "Smith"}`
 *
 * The third is what Okta and Entra actually send, and it was the one being
 * dropped on the floor: the handler skipped any operation whose `value` was
 * not an object, so the call returned 200 with the record unchanged and the
 * request log filed it as "Accepted".
 */
export function namePartsIn({
  path,
  value,
}: {
  path: string | undefined;
  value: unknown;
}): { givenName?: string; familyName?: string } | undefined {
  const scalar = typeof value === "string" ? value : undefined;
  if (path === "name.givenName" && scalar !== undefined) {
    return { givenName: scalar };
  }
  if (path === "name.familyName" && scalar !== undefined) {
    return { familyName: scalar };
  }

  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;

  // `{path: "name", value: {givenName, familyName}}`: the parts arrive
  // UNWRAPPED, because the path already said which attribute they belong to.
  // Read before the wrapped form, which looks for a `name` key this spelling
  // does not carry.
  if (path === "name") return partsAt(record, "givenName", "familyName");

  const nested = record.name;
  if (nested && typeof nested === "object") {
    return partsAt(
      nested as Record<string, unknown>,
      "givenName",
      "familyName",
    );
  }

  return partsAt(record, "name.givenName", "name.familyName");
}

/**
 * The two halves read off one record under whichever keys carry them.
 *
 * All three object spellings differ only in where they put the halves, so
 * they differ only in the two key names handed here. Written out three times
 * the shapes had already started to drift apart.
 */
function partsAt(
  source: Record<string, unknown>,
  givenKey: string,
  familyKey: string,
): { givenName?: string; familyName?: string } | undefined {
  const given = source[givenKey];
  const family = source[familyKey];
  const parts = {
    ...(typeof given === "string" ? { givenName: given } : {}),
    ...(typeof family === "string" ? { familyName: family } : {}),
  };
  return Object.keys(parts).length > 0 ? parts : undefined;
}
