# ADR-002: A filter we cannot honour is refused, and a name is patched one half at a time

**Status:** Accepted

**Behavioural contract:** [Enterprise SCIM](../specs/scim.feature)

## Context

Both SCIM listings took a `filter` and read it with a regular expression that
matched the single attribute each understood, returning `null` for everything
else — and `null` meant the same thing as "no filter at all". A provider asking
for one person by an attribute the directory did not support was therefore
answered with the WHOLE ORGANIZATION, and a provider reads the first row back
as the person it asked about. The lookup meant to find nobody found a stranger,
and the next call wrote to them.

Separately, SCIM carries a name as `givenName` and `familyName` while this
product stores one string. Three spellings of a name PATCH reach the door and
all three are legitimate SCIM:

- a nested object: `{path: "name", value: {givenName, familyName}}`
- dotted keys: `{value: {"name.givenName": "Ada"}}`
- a dotted path with a scalar: `{path: "name.familyName", value: "Smith"}`

The third is what Okta and Entra actually send, and it was dropped on the floor:
the patch service skipped any operation whose `value` was not an object, so the
call returned 200 with the record unchanged. Where a dotted key _was_ read, the
stored name was rebuilt from the half supplied, so patching a surname threw the
forename away.

## Decision

`parseScimFilter` is the one place a SCIM `filter` is read. It honours
`attribute eq "value"` and nothing else, against a per-listing closed set of
attributes, and refuses anything else with RFC 7644 §3.4.2.2's `invalidFilter`
at 400. Refusing is not strictness for its own sake: it is the only answer that
cannot be mistaken for a match, and a provider that receives it stops. Anything
richer than `eq` is refused rather than half-honoured — an `sw` quietly treated
as `eq` would be the same silent-wrong-answer bug in a smaller costume.

Attribute names compare case-insensitively (RFC 7644 §3.4.2.2 says they are, and
providers vary: Entra sends `userName`, some tooling sends `username`). The
refusal names the ATTRIBUTE and never the value — a refusal is a place a value
gets logged and read by people, and an address is the one thing these filters
carry.

`namePartsIn` reads the parts out of whichever of the three spellings arrived,
and `mergeNameParts` merges them over the stored name rather than replacing it.
Splitting a stored string back into halves is lossy by nature; splitting on the
FIRST space is the inverse of the join that wrote it, so a name this product
created round-trips unchanged, and one it did not is at worst reassembled the
way it was already being displayed.

## Consequences

A provider filtering `/Users` by an attribute other than `userName`, or
`/Groups` by anything other than `displayName`, now receives a 400 carrying
`invalidFilter` where it previously received an unfiltered page. That is a
visible change for any provider that was relying on the unfiltered answer, and
it is the change: the unfiltered answer was wrong.

`scimErrorSchema` gains an optional `scimType`, which is additive on the wire.
