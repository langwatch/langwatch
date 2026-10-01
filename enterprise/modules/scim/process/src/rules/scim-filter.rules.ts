// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The one place a SCIM `filter` is read: `attribute eq "value"` and nothing
 * else, against a closed set per listing. Why refusing beats half-honouring:
 * ADR-002 (`enterprise/modules/scim/adrs/002-*.md`).
 */

/** Attributes a listing can actually match on. */
export type ScimFilterAttribute = "userName" | "externalId" | "displayName";

/** One `attribute eq "value"` term — the whole of what we honour. */
export interface ScimFilterTerm {
  attribute: ScimFilterAttribute;
  value: string;
}

export type ScimFilterParse =
  /** No filter, or one we can honour. `term` is null for "list everybody". */
  | { ok: true; term: ScimFilterTerm | null }
  /** A filter we will not answer. `detail` is customer-safe. */
  | { ok: false; detail: string };

/** Attribute names are case-insensitive (RFC 7644 §3.4.2.2); providers vary. */
const EQ_TERM = /^\s*([A-Za-z][\w.$]*)\s+eq\s+"([^"]*)"\s*$/;

export function parseScimFilter({
  filter,
  supported,
}: {
  filter?: string | undefined;
  /** Which attributes this listing can match on, in the spelling to return. */
  supported: readonly ScimFilterAttribute[];
}): ScimFilterParse {
  if (!filter || filter.trim() === "") {
    return { ok: true, term: null };
  }

  const match = filter.match(EQ_TERM);
  if (!match) {
    return {
      ok: false,
      detail: `Unsupported filter expression. This directory supports ${describeSupported(supported)}.`,
    };
  }

  const [, rawAttribute = "", value = ""] = match;
  const attribute = supported.find(
    (candidate) => candidate.toLowerCase() === rawAttribute.toLowerCase(),
  );
  if (!attribute) {
    // The ATTRIBUTE is named and the value is not: a refusal is read by
    // people, and an address is the one thing these filters carry.
    return {
      ok: false,
      detail: `Filtering by "${rawAttribute}" is not supported. This directory supports ${describeSupported(supported)}.`,
    };
  }

  return { ok: true, term: { attribute, value } };
}

function describeSupported(supported: readonly ScimFilterAttribute[]): string {
  return supported.map((attribute) => `${attribute} eq "…"`).join(" and ");
}
