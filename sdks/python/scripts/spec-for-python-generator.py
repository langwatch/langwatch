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
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(spec, indent=2))
    print(f"spec-for-python-generator: wrote {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
