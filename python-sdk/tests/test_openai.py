import pytest
import openai
import langwatch.openai

def test_trace_session_captures_openai_calls():
    with langwatch.openai.trace():
        openai.Completion.create(model="babbage-002", prompt="hi")
        openai.Completion.create(model="babbage-002", prompt="foo")

    with langwatch.openai.trace():
        openai.Completion.create(model="babbage-002", prompt="we will we will rock")
        openai.Completion.create(model="babbage-002", prompt="heey hey baby uh")