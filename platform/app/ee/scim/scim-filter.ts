// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The one place a SCIM `filter` is read.
 *
 * Both listings take a filter and both used to read it with a regular
 * expression that matched the single attribute they understood and returned
 * null for everything else — and "null" and "no filter at all" were the same
 * value. So a provider asking for one person by an attribute we did not
 * support was answered with the WHOLE ORGANIZATION, and a provider reads the
 * first row back as the person it asked about. The lookup that was meant to
 * find nobody found a stranger, and the next call wrote to them.
 *
 * Refusing is therefore not strictness for its own sake: it is the only
 * answer that cannot be mistaken for a match. RFC 7644 §3.4.2.2 says the same
 * thing in protocol terms — an unsupported filter is a 400 carrying
 * `invalidFilter` — and a provider that receives one stops, which is what we
 * want it to do.
 *
 * Deliberately a hair over one attribute per resource: `userName` for people
 * because that is what Okta looks people up by, `externalId` because that is
 * what Entra uses and what survives somebody changing their address. Anything
 * richer than `eq` is refused rather than half-honoured — a `sw` we quietly
 * treated as `eq` would be the same silent-wrong-answer bug in a smaller
 * costume.
 */

/** Attributes a listing can actually match on. */
export type ScimFilterAttribute = "userName" | "externalId" | "displayName";

/** One `attribute eq "value"` term — the whole of what we honour. */
export interface ScimFilterTerm {
  attribute: ScimFilterAttribute;
  value: string;
}

export type ScimFilterParse =
  /** No filter, or a filter we can honour. `term` is null for "list everybody". */
  | { ok: true; term: ScimFilterTerm | null }
  /** A filter we will not answer. `detail` is customer-safe. */
  | { ok: false; detail: string };

/**
 * `attribute eq "value"`, and nothing else.
 *
 * Attribute names are compared case-insensitively because RFC 7644 §3.4.2.2
 * says they are case-insensitive, and providers do vary: Entra sends
 * `userName`, some tooling sends `username`.
 */
const EQ_TERM = /^\s*([A-Za-z][\w.$]*)\s+eq\s+"([^"]*)"\s*$/;

export function parseScimFilter({
  filter,
  supported,
}: {
  filter?: string;
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
    // The ATTRIBUTE is named and the value is not. What a provider sent us is
    // its business, but a refusal is a place a value gets logged and read by
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
