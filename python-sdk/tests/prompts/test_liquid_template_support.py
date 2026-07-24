"""
Tests for full Liquid template support in the Python SDK.

Verifies that compile() and compile_strict() properly expose
python-liquid's Liquid template features: if/else, for loops,
assign tags, filters, and strict/lenient undefined variable handling.

Spec: specs/prompts/liquid-template-support.feature (Python SDK section)
"""

import pytest

from langwatch.prompts.prompt import Prompt, PromptCompilationError


def _make_prompt(template: str) -> Prompt:
    """Create a Prompt with the given template string as the prompt field."""
    return Prompt(prompt=template, model="gpt-4")


class TestCompileWithLiquidConstructs:
    """compile() with Liquid constructs"""

    class TestWhenTemplateContainsIfElseConditions:
        def test_renders_the_matching_branch(self):
            prompt = _make_prompt(
                "{% if tone == 'formal' %}Dear user{% else %}Hey{% endif %}, welcome!"
            )

            compiled = prompt.compile({"tone": "formal"})

            assert compiled.prompt == "Dear user, welcome!"

    class TestWhenTemplateContainsForLoops:
        def test_renders_loop_over_array(self):
            prompt = _make_prompt(
                "Topics: {% for item in topics %}{{ item }}"
                "{% unless forloop.last %}, {% endunless %}{% endfor %}"
            )

            compiled = prompt.compile({"topics": ["AI", "ML", "NLP"]})

            assert compiled.prompt == "Topics: AI, ML, NLP"

    class TestWhenTemplateContainsAssignTags:
        def test_renders_assigned_variable(self):
            prompt = _make_prompt(
                "{% assign greeting = 'Hello' %}{{ greeting }}, {{ name }}!"
            )

            compiled = prompt.compile({"name": "Alice"})

            assert compiled.prompt == "Hello, Alice!"

    class TestWhenTemplateContainsFilters:
        def test_renders_upcase_and_truncate_filters(self):
            prompt = _make_prompt(
                "{{ name | upcase }} - {{ description | truncate: 20 }}"
            )

            compiled = prompt.compile(
                {
                    "name": "alice",
                    "description": "This is a very long description text",
                }
            )

            # python-liquid truncate: 20 means 20 total chars including "..."
            # This differs from LiquidJS where 20 means 20 chars of content + "..."
            assert compiled.prompt == "ALICE - This is a very lo..."

    class TestWhenTemplateHasUndefinedVariables:
        def test_compile_tolerates_undefined_variables(self):
            prompt = _make_prompt(
                "{% if mood == 'happy' %}Great!{% endif %} Hello"
            )

            compiled = prompt.compile({})

            assert compiled.prompt == " Hello"


class TestCompileStrictWithLiquidConstructs:
    """compile_strict() with Liquid constructs"""

    class TestWhenTemplateReferencesUndefinedVariables:
        def test_raises_prompt_compilation_error(self):
            prompt = _make_prompt(
                "{% if mood == 'happy' %}Great!{% endif %}"
            )

            with pytest.raises(PromptCompilationError):
                prompt.compile_strict({})
