"""Unit tests for the Zod emission in generate_evaluators_ts.

Covers the pydantic-annotation -> Zod mapping and the optional/describe/default
modifier ordering, using synthetic models so the test does not depend on the
installed evaluator packages.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from generate_evaluators_ts import field_to_zod, settings_to_zod


def zod_for(model: type, field_name: str) -> str:
    return field_to_zod(model.model_fields[field_name])


def test_primitive_with_description_and_default():
    class M(BaseModel):
        model: str = Field("openai/gpt-5", description="The model to use for evaluation.")

    assert (
        zod_for(M, "model")
        == 'z.string().describe("The model to use for evaluation.").default("openai/gpt-5")'
    )


def test_number_default():
    class M(BaseModel):
        max_tokens: int = Field(2048, description="Max tokens")

    assert zod_for(M, "max_tokens") == 'z.number().describe("Max tokens").default(2048)'


def test_boolean_false_default_is_surfaced():
    class M(BaseModel):
        case_sensitive: bool = Field(False, description="Case sensitive")

    assert (
        zod_for(M, "case_sensitive")
        == 'z.boolean().describe("Case sensitive").default(false)'
    )


def test_falsy_defaults_are_surfaced():
    # Zero, empty string, empty list, empty dict are real defaults — they must
    # keep their .default(...), not be dropped as "falsy".
    class M(BaseModel):
        count: int = 0
        label: str = ""
        items: List[str] = []

    assert zod_for(M, "count") == "z.number().default(0)"
    assert zod_for(M, "label") == 'z.string().default("")'
    assert zod_for(M, "items") == "z.array(z.string()).default([])"


def test_literal_union_with_default():
    class M(BaseModel):
        mode: Literal["f1", "precision", "recall"] = "f1"

    assert (
        zod_for(M, "mode")
        == 'z.union([z.literal("f1"), z.literal("precision"), z.literal("recall")]).default("f1")'
    )


def test_optional_literal_without_default_is_optional():
    class M(BaseModel):
        expected_language: Optional[Literal["AF", "EN"]] = None

    # None default -> no .default(), just .optional()
    assert (
        zod_for(M, "expected_language")
        == 'z.union([z.literal("AF"), z.literal("EN")]).optional()'
    )


def test_optional_string_without_default():
    class M(BaseModel):
        json_schema: Optional[str] = Field(None, description="JSON schema")

    assert zod_for(M, "json_schema") == 'z.string().optional().describe("JSON schema")'


def test_list_default():
    class M(BaseModel):
        competitors: List[str] = Field(["OpenAI", "Google"], description="Competitors")

    assert (
        zod_for(M, "competitors")
        == 'z.array(z.string()).describe("Competitors").default(["OpenAI", "Google"])'
    )


def test_nested_model_with_per_field_defaults():
    class Entities(BaseModel):
        credit_card: bool = True
        location: bool = False

    class M(BaseModel):
        entities: Entities = Field(Entities(), description="PII entities")

    out = zod_for(M, "entities")
    assert out.startswith(
        'z.object({"credit_card": z.boolean().default(true), "location": z.boolean().default(false)})'
    )
    assert '.describe("PII entities")' in out
    assert '.default({"credit_card": true, "location": false})' in out


def test_numeric_literal_union():
    class M(BaseModel):
        severity: Literal[1, 2, 3] = 1

    assert (
        zod_for(M, "severity")
        == "z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1)"
    )


def test_empty_settings_is_record_never():
    class Empty(BaseModel):
        pass

    assert settings_to_zod(Empty) == "z.record(z.string(), z.never())"


def test_description_newlines_collapse():
    class M(BaseModel):
        prompt: str = Field("x", description="line one\nline two")

    assert '.describe("line one. line two")' in zod_for(M, "prompt")


if __name__ == "__main__":
    import sys

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
