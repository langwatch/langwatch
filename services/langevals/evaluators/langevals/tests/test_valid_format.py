import json
from langevals_langevals.valid_format import (
    ValidFormatEvaluator,
    ValidFormatEntry,
    ValidFormatSettings,
)


def test_valid_format_evaluator_json():
    # Test valid JSON
    entry = ValidFormatEntry(output='{"key": "value", "number": 42}')
    evaluator = ValidFormatEvaluator(settings=ValidFormatSettings(format="json"))
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True

    # Test invalid JSON
    entry = ValidFormatEntry(output='{"key": "value", number: 42}')  # missing quotes
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert "Invalid JSON" in result.details  # type: ignore


def test_valid_format_evaluator_markdown():
    # Test valid Markdown
    entry = ValidFormatEntry(output="# Header\n\nThis is **bold** text")
    evaluator = ValidFormatEvaluator(settings=ValidFormatSettings(format="markdown"))
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True

    # Test invalid Markdown
    entry = ValidFormatEntry(
        output="This is just a normal text, no markdown formatting here\n\nBut what if I break the line?"
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert "No markdown elements found" in result.details  # type: ignore


def test_valid_format_evaluator_python():
    # Test valid Python
    entry = ValidFormatEntry(output="def hello():\n    print('Hello, World!')")
    evaluator = ValidFormatEvaluator(settings=ValidFormatSettings(format="python"))
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True

    # Test invalid Python
    entry = ValidFormatEntry(
        output="def hello() print('Hello, World!')"
    )  # missing colon
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert "Invalid Python" in result.details  # type: ignore


def test_valid_format_evaluator_sql():
    # Test valid SQL
    entry = ValidFormatEntry(output="SELECT * FROM users WHERE age > 18;")
    evaluator = ValidFormatEvaluator(settings=ValidFormatSettings(format="sql"))
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True

    # Test invalid SQL
    entry = ValidFormatEntry(
        output="SELECT * FORM users WHERE age >> 18;"
    )  # FORM instead of FROM, invalid operator >>
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert "Invalid SQL" in result.details  # type: ignore

    # SQL is not valid json
    entry = ValidFormatEntry(output='{"foo": "bar"}')
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert "Invalid SQL" in result.details  # type: ignore


def test_valid_format_evaluator_empty_input():
    entry = ValidFormatEntry(output=None)
    evaluator = ValidFormatEvaluator(settings=ValidFormatSettings(format="json"))
    result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert "Output is empty" in result.details  # type: ignore


def test_valid_format_evaluator_empty_string():
    entry = ValidFormatEntry(output="")
    evaluator = ValidFormatEvaluator(settings=ValidFormatSettings(format="json"))
    result = evaluator.evaluate(entry)

    assert result.status == "skipped"
    assert "Output is empty" in result.details  # type: ignore


def test_valid_format_evaluator_json_schema():
    # Test valid JSON with schema
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "number"},
            "email": {"type": "string"},
        },
        "required": ["name", "age", "email"],
    }

    # Valid JSON according to schema
    entry = ValidFormatEntry(
        output='{"name": "John Doe", "age": 30, "email": "john@example.com"}'
    )
    evaluator = ValidFormatEvaluator(
        settings=ValidFormatSettings(format="json", json_schema=json.dumps(schema))
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == True

    # Invalid JSON according to schema (missing required field)
    entry = ValidFormatEntry(output='{"name": "John Doe", "age": 30}')
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert "JSON Schema validation failed" in result.details  # type: ignore

    # Invalid JSON according to schema (wrong type)
    entry = ValidFormatEntry(
        output='{"name": "John Doe", "age": "thirty", "email": "john@example.com"}'
    )
    result = evaluator.evaluate(entry)

    assert result.status == "processed"
    assert result.passed == False
    assert "JSON Schema validation failed" in result.details  # type: ignore
