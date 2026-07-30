import { MalformedGroupKeyError } from "../errors";
import type { GroupKey, Lane, Scope } from "./groupKey.types";

/**
 * Rendering and parsing for the dispatch-plane group key (ADR-100).
 *
 * Three properties this module owns, so no call site has to:
 *
 * 1. **Escaping.** Segment values are arbitrary strings — trace ids,
 *    conversation ids, tenant-supplied dimension values. Concatenating them
 *    with a raw separator lets one scope collide with a structurally different
 *    one, which silently merges two lanes.
 * 2. **The Redis Cluster hash tag.** GroupQueue's multi-key Lua requires every
 *    key for one group to hash to one slot, so the rendered key carries exactly
 *    one `{…}` and its contents are escaped to contain no further braces.
 * 3. **Reversibility.** A rendered key parses back to the descriptor that
 *    produced it, so operational views can filter by tenant, lane or scope
 *    without pattern-matching on prose.
 */

const SEPARATOR = "/";

/**
 * Escapes the characters that carry structure. The escape character itself is
 * escaped first, so the transformation is injective and therefore reversible.
 *
 * Braces are escaped because Redis reads the first `{` and the first `}` after
 * it as the hash tag; an unescaped brace inside a segment would truncate the
 * tag and scatter one group's keys across slots.
 */
export function escapeSegment(value: string): string {
  let out = "";
  for (const ch of value) {
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case SEPARATOR:
        out += "\\s";
        break;
      case "{":
        out += "\\l";
        break;
      case "}":
        out += "\\r";
        break;
      default:
        out += ch;
    }
  }
  return out;
}

export function unescapeSegment(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    i += 1;
    switch (value[i]) {
      case "\\":
        out += "\\";
        break;
      case "s":
        out += SEPARATOR;
        break;
      case "l":
        out += "{";
        break;
      case "r":
        out += "}";
        break;
      default:
        // A lone trailing backslash, or an unknown escape: preserve it rather
        // than dropping a character, so a malformed key round-trips visibly
        // instead of quietly changing identity.
        out += "\\";
        if (value[i] !== undefined) out += value[i];
    }
  }
  return out;
}

/**
 * `fold/traceSummary`, or `commandAll` for the aggregate-serialised command
 * lane.
 *
 * The serialised lane gets its own discriminator rather than simply omitting
 * the name segment. Omission would be ambiguous: a lane named `agg` is legal,
 * so a parser could not tell `command/agg/…` — the command named `agg` — from
 * the serialised lane followed by an aggregate scope. Encoding the distinction
 * in the discriminator removes the ambiguity instead of relying on lookahead.
 */
function renderLane(lane: Lane): string {
  return lane.kind === "command" && lane.name === undefined
    ? "commandAll"
    : `${lane.kind}${SEPARATOR}${escapeSegment(lane.name ?? "")}`;
}

/**
 * The scope's segments. The leading discriminator is what stops a `partition`
 * scope of `["trace", "t1"]` rendering identically to an `aggregate` scope of
 * type `trace` and id `t1` — different lanes must never share a key.
 */
function renderScope(scope: Scope): string {
  switch (scope.kind) {
    case "aggregate":
      return [
        "agg",
        escapeSegment(scope.aggregateType),
        escapeSegment(scope.aggregateId),
      ].join(SEPARATOR);
    case "event":
      return ["evt", escapeSegment(scope.eventId)].join(SEPARATOR);
    case "partition":
      return ["part", ...scope.parts.map(escapeSegment)].join(SEPARATOR);
    case "global":
      return "all";
  }
}

/**
 * Renders the key, wrapping the whole thing in one hash tag.
 *
 * Tagging the entire key rather than a prefix means each group gets its own
 * slot — groups spread across the cluster while every key belonging to one
 * group stays colocated, which is exactly what the per-group Lua requires.
 */
export function renderGroupKey(key: GroupKey): string {
  const body = [
    escapeSegment(key.tenantId),
    renderLane(key.lane),
    renderScope(key.scope),
  ].join(SEPARATOR);
  return `{${body}}`;
}

/** Splits on separators that are not part of an escape sequence. */
function splitUnescaped(body: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      current += ch;
      i += 1;
      if (i < body.length) current += body[i];
      continue;
    }
    if (ch === SEPARATOR) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

export function parseGroupKey(rendered: string): GroupKey {
  if (!rendered.startsWith("{") || !rendered.endsWith("}")) {
    throw new MalformedGroupKeyError(rendered, "missing hash tag");
  }
  const segments = splitUnescaped(rendered.slice(1, -1));
  const [rawTenant, laneKind] = segments;
  if (rawTenant === undefined || laneKind === undefined) {
    throw new MalformedGroupKeyError(rendered, "too few segments");
  }

  // `commandAll` carries no name segment, so its scope starts one earlier.
  const isSerialisedCommand = laneKind === "commandAll";
  const lane: Lane = isSerialisedCommand
    ? { kind: "command" }
    : parseNamedLane(rendered, laneKind, segments[2]);
  const scope = parseScope(rendered, segments.slice(isSerialisedCommand ? 2 : 3));

  return { tenantId: unescapeSegment(rawTenant), lane, scope };
}

function parseNamedLane(
  rendered: string,
  kind: string,
  rawName: string | undefined,
): Lane {
  if (rawName === undefined) {
    throw new MalformedGroupKeyError(rendered, "lane has no name");
  }
  const name = unescapeSegment(rawName);
  switch (kind) {
    case "fold":
    case "map":
    case "subscriber":
    case "processManager":
    case "command":
    case "job":
      return { kind, name } as Lane;
    default:
      throw new MalformedGroupKeyError(rendered, `unknown lane "${kind}"`);
  }
}

function parseScope(rendered: string, segments: string[]): Scope {
  const [kind, ...rest] = segments;
  switch (kind) {
    case "agg": {
      const [type, id] = rest;
      if (type === undefined || id === undefined) {
        throw new MalformedGroupKeyError(rendered, "aggregate scope needs 2 parts");
      }
      return {
        kind: "aggregate",
        aggregateType: unescapeSegment(type),
        aggregateId: unescapeSegment(id),
      };
    }
    case "evt": {
      const [eventId] = rest;
      if (eventId === undefined) {
        throw new MalformedGroupKeyError(rendered, "event scope needs an id");
      }
      return { kind: "event", eventId: unescapeSegment(eventId) };
    }
    case "part":
      return { kind: "partition", parts: rest.map(unescapeSegment) };
    case "all":
      return { kind: "global" };
    default:
      throw new MalformedGroupKeyError(rendered, `unknown scope "${kind}"`);
  }
}

/**
 * Whether a lane may batch. A batch is drawn from one lane, and an `event`
 * scope puts every event in a lane of its own, so no batch can ever form.
 *
 * Callers configuring a batch size use this to fail at mount time rather than
 * silently running with a batch of 1 — the shape that leaves a rollup writing
 * one insert per event into a table that exists to avoid exactly that.
 */
export function scopeCanBatch(scope: Scope): boolean {
  return scope.kind !== "event";
}
