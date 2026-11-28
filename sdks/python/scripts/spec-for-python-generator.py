"""Write a copy of the OpenAPI spec that openapi-python-client can parse.

The spec's `JsonValue` component is recursive: a union whose array and object
arms refer back to the component itself. That is legal OpenAPI 3.1 and it is
what the zod schema behind it actually means, so the canonical document keeps
it. Generators disagree about the construct, and each is handled at its own
boundary rather than by degrading the shared contract:

  - openapi-typescript emits it as a self referential indexed access that
    TypeScript rejects, and the TS SDK hoists it to a standalone alias in
    `scripts/patch-generated-openapi.mjs`.
  - openapi-python-client cannot parse it at all. It does not fail the run;
    it drops every response that mentions `JsonValue` and the models for
    those responses never reach the generated package. That silently removed
    `get_api_prompts_by_id_response_200` and its children, which the
    hand-written prompts facade imports, so the SDK stopped importing at all.

Here the component is flattened to the empty schema, which in OpenAPI 3.1
already means "any JSON value". That is exactly what the recursive form
means, so nothing the recursion constrained is lost: it says "valid JSON"
the long way round, and this says it the way the generator understands.

Only the generator's input copy is rewritten. The published spec, and the
TypeScript client generated from it, are untouched.
"""

import json
import sys
from pathlib import Path

FLATTENED = {
    "description": "Any JSON value: a string, number, boolean, null, array, or object.",
}


def flatten_self_reference(node, ref):
    """The span value's `list` arm nests itself; the generator rejects that as it does JsonValue."""
    if isinstance(node, dict):
        if node.get("$ref") == ref:
            return dict(FLATTENED)
        return {key: flatten_self_reference(value, ref) for key, value in node.items()}
    if isinstance(node, list):
        return [flatten_self_reference(value, ref) for value in node]
    return node


def relax_prompt_schema(node):
    """Prompts keep the published SDK's reading: dates stay wire strings, platformUrl optional."""
    if isinstance(node, dict):
        relaxed = {
            key: relax_prompt_schema(value)
            for key, value in node.items()
            if not (key == "format" and value == "date-time")
        }
        if isinstance(relaxed.get("required"), list) and "platformUrl" in relaxed.get("properties", {}):
            relaxed["required"] = [name for name in relaxed["required"] if name != "platformUrl"]
        return relaxed
    if isinstance(node, list):
        return [relax_prompt_schema(value) for value in node]
    return node


def open_registry_event_type(item):
    """A registry feed event's `type` reads a type a later release adds as a plain string.

    The generator turns an enum into a closed Enum whose constructor raises on any other value,
    so a client would fail on a whole feed page the day the server adds an event type. The
    union keeps the Enum for known values and falls back to the string for the rest.
    """
    if not isinstance(item, dict):
        return item
    for operation in item.values():
        if not isinstance(operation, dict):
            continue
        for response in operation.get("responses", {}).values():
            for media in response.get("content", {}).values() if isinstance(response, dict) else []:
                items = media.get("schema", {}).get("properties", {}).get("data", {}).get("items", {})
                properties = items.get("properties", {})
                known = properties.get("type")
                if isinstance(known, dict) and "enum" in known:
                    # The title keeps the Enum class name the closed field had.
                    titled = {**known, "title": "type"}
                    properties["type"] = {"anyOf": [titled, {"type": "string"}]}
    return item


REGISTRY_ENTRY_FIELDS_ADDED_LATER = ("dormant", "posture", "platform", "labels", "owner_label")


def relax_registry_entry(node):
    """A registry entry reads an older server's payload, which lacks the fields added with posture."""
    if isinstance(node, dict):
        relaxed = {key: relax_registry_entry(value) for key, value in node.items()}
        required = relaxed.get("required")
        if isinstance(required, list) and "dormant" in relaxed.get("properties", {}):
            relaxed["required"] = [n for n in required if n not in REGISTRY_ENTRY_FIELDS_ADDED_LATER]
        return relaxed
    if isinstance(node, list):
        return [relax_registry_entry(value) for value in node]
    return node


def is_registry_event_feed(path):
    """The change feed and an agent's versions: both answer pages of registry events."""
    return "/governance/registry/" in path and path.endswith(("/events", "/versions"))


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: spec-for-python-generator.py <source-spec> <destination-spec>",
            file=sys.stderr,
        )
        return 2

    source, destination = Path(sys.argv[1]), Path(sys.argv[2])
    spec = json.loads(source.read_text())

    schemas = spec.get("components", {}).get("schemas", {})
    if "JsonValue" not in schemas:
        # The component is gone or was renamed. Say so rather than writing a
        # copy that silently no longer needs this step.
        print(
            "spec-for-python-generator: no JsonValue component found; "
            "if the recursive schema was removed upstream, delete this script "
            "and its Makefile step.",
            file=sys.stderr,
        )
        return 1

    schemas["JsonValue"] = dict(FLATTENED)
    for path, item in spec.get("paths", {}).items():
        if path.startswith("/api/v1/prompts"):
            spec["paths"][path] = relax_prompt_schema(item)
        if "/governance/registry/" in path:
            spec["paths"][path] = relax_registry_entry(spec["paths"][path])
        if is_registry_event_feed(path):
            spec["paths"][path] = open_registry_event_type(spec["paths"][path])
    if "SpanInputOutput" in schemas:
        schemas["SpanInputOutput"] = flatten_self_reference(
            schemas["SpanInputOutput"], "#/components/schemas/SpanInputOutput"
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(spec, indent=2))
    print(f"spec-for-python-generator: wrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
