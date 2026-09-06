#!/usr/bin/env python3
"""Down-convert the canonical OpenAPI 3.1 document to a 3.0.3-compatible one.

The LangWatch API spec (langwatch/src/app/api/openapiLangWatch.json) is authored
as OpenAPI 3.1.0. The Go code generator (oapi-codegen, via kin-openapi) only
understands OpenAPI 3.0, so this script performs a small, deterministic,
loss-free-for-our-purposes down-conversion of the handful of 3.1-only JSON Schema
constructs the spec actually uses. The canonical 3.1 spec is never modified; the
3.0 output is committed alongside the generated Go so `go build` works without
re-running anything.

Transforms applied (and why each is safe for codegen):

  1. type: "null"            -> {nullable: true}              (empty schema => Go `any`)
     A 3.1 "always null" leaf. 3.0 has no null type; an empty nullable schema is
     the closest faithful rendering and codegen emits `interface{}`.

  2. type: ["X", "null"]     -> type: "X", nullable: true     (3.0 nullable form)
     The 3.1 way of saying "X or null". 3.0 expresses optionality via `nullable`.

  3. type: ["X", "Y", ...]   -> anyOf: [{type:X},{type:Y},...] (multi-type union)
     A genuine multi-type union. 3.0 has no list-typed `type`; anyOf is the
     standard equivalent. (The spec currently has none of these, but we handle it
     so the converter stays correct if the spec grows one.)

  4. const: V                -> enum: [V]                     (single-value enum)
     3.0 predates JSON Schema `const`; a one-element `enum` is the exact 3.0
     equivalent and codegen renders it as a typed constant set.

  5. exclusiveMinimum: N     -> minimum: N, exclusiveMinimum: true   (and Maximum)
     3.1 makes exclusiveMinimum a number; 3.0 makes it a boolean paired with
     `minimum`. Codegen only reads these for validation comments, so this is
     purely cosmetic but required to parse.

  6. anyOf/oneOf with a {type:null} member -> drop the member, add nullable: true
     (and, when only one real member remains, inline it). The 3.1 idiom for an
     optional composed schema; 3.0 expresses it with `nullable`.

Usage:
    python3 downconvert.py <source-3.1.json> <dest-3.0.json>
"""

import json
import sys


def convert(node):
    """Recursively rewrite a JSON node from 3.1 to 3.0 schema dialect."""
    if isinstance(node, list):
        return [convert(x) for x in node]
    if not isinstance(node, dict):
        return node

    # (1) bare type: "null" -> nullable empty schema (renders as Go `any`).
    if node.get("type") == "null":
        node.pop("type")
        node["nullable"] = True

    # (2)/(3) list-valued type -> single type + nullable, or anyOf union.
    declared_type = node.get("type")
    if isinstance(declared_type, list):
        non_null = [x for x in declared_type if x != "null"]
        had_null = "null" in declared_type
        if len(non_null) == 1:
            node["type"] = non_null[0]
        elif len(non_null) == 0:
            node.pop("type", None)
        else:
            node.pop("type")
            node["anyOf"] = node.get("anyOf", []) + [{"type": x} for x in non_null]
        if had_null:
            node["nullable"] = True

    # (4) const -> single-value enum.
    if "const" in node:
        node["enum"] = [node.pop("const")]

    # (5) numeric exclusiveMinimum/exclusiveMaximum -> 3.0 boolean form.
    for keyword, base in (("exclusiveMinimum", "minimum"), ("exclusiveMaximum", "maximum")):
        value = node.get(keyword)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            node[base] = value
            node[keyword] = True

    # (6) anyOf/oneOf carrying a {type:null} member -> nullable + (maybe) inline.
    for key in ("anyOf", "oneOf"):
        if isinstance(node.get(key), list):
            members = node[key]
            null_members = [
                m for m in members
                if isinstance(m, dict) and m.get("type") == "null" and len(m) == 1
            ]
            if null_members:
                node[key] = [m for m in members if m not in null_members]
                node["nullable"] = True
                # If exactly one real member remains and this node carries nothing
                # else of substance, fold it up so codegen names the type cleanly.
                if len(node[key]) == 1 and not (set(node.keys()) - {key, "nullable"}):
                    only = node.pop(key)[0]
                    node.update(only)
                    node["nullable"] = True

    return {k: convert(v) for k, v in node.items()}


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    source, dest = sys.argv[1], sys.argv[2]
    with open(source) as handle:
        spec = json.load(handle)
    spec["openapi"] = "3.0.3"
    spec = convert(spec)
    with open(dest, "w") as handle:
        json.dump(spec, handle, indent=2)
        handle.write("\n")
    print(f"down-converted {source} -> {dest}")


if __name__ == "__main__":
    main()
