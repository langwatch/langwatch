import pytest
from langwatch.prompt.formatter import PromptFormatter, MissingPromptVariableError

@pytest.fixture
def formatter():
    return PromptFormatter()

def test_basic_formatting(formatter):
    template = "Hello {{ name }}!"
    variables = {"name": "World"}
    result = formatter.format(template, variables)
    assert result == "Hello World!"

def test_multiple_variables(formatter):
    template = "{{ greeting }}, {{ name }}! How are you {{ time }}?"
    variables = {
        "greeting": "Hello",
        "name": "World",
        "time": "today"
    }
    result = formatter.format(template, variables)
    assert result == "Hello, World! How are you today?"

def test_missing_variable(formatter):
    template = "Hello {{ name }}!"
    variables = {}

    with pytest.raises(MissingPromptVariableError) as exc_info:
        formatter.format(template, variables)

    assert "name" in exc_info.value.missing_vars

def test_whitespace_handling(formatter):
    template = "Hello {{  name  }}!"
    variables = {"name": "World"}
    result = formatter.format(template, variables)
    assert result == "Hello World!"

def test_special_characters(formatter):
    template = "{{ greeting }} {{ name }}! {{ punctuation }}"
    variables = {
        "greeting": "Hello",
        "name": "World",
        "punctuation": "!!!"
    }
    result = formatter.format(template, variables)
    assert result == "Hello World! !!!"
