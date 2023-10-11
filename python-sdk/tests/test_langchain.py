from datetime import datetime
import json
import time
from freezegun import freeze_time

from langchain.chat_models import ChatOpenAI
from langchain.prompts.chat import ChatPromptTemplate
from langchain.schema import (
    BaseOutputParser,
)
from langchain.chains import LLMChain
import requests_mock

import langwatch
import langwatch.langchain

from tests.utils import *


class CommaSeparatedListOutputParser(BaseOutputParser):
    """Parse the output of an LLM call to a comma-separated list."""

    def parse(self, text: str):
        """Parse the output of an LLM call."""
        return text.strip().split(", ")


class TestLangChainTracer:
    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_lang_chain_calls(self):
        with requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})
            mock_request.post(
                "https://api.openai.com/v1/chat/completions",
                json=create_openai_chat_completion_mock("red, blue, green, yellow"),
            )

            template = """You are a helpful assistant who generates comma separated lists.
            A user will pass in a category, and you should generate 5 objects in that category in a comma separated list.
            ONLY return a comma separated list, and nothing more."""
            human_template = "{text}"

            chat_prompt = ChatPromptTemplate.from_messages(
                [
                    ("system", template),
                    ("human", human_template),
                ]
            )
            chain = LLMChain(
                llm=ChatOpenAI(),
                prompt=chat_prompt,
                # TODO: output_parser=CommaSeparatedListOutputParser(),
            )
            result = chain.run(
                text="colors", callbacks=[langwatch.langchain.LangWatchCallback()]
            )
            assert result == "red, blue, green, yellow"

            time.sleep(1)
            request_history = [
                r for r in mock_request.request_history if "langwatch" in r.url
            ]
            first_span = request_history[0].json()["spans"][0]
            assert first_span["trace_id"].startswith("trace_")
            assert first_span["vendor"] == "openai"
            assert first_span["model"] == "gpt-3.5-turbo"
            assert first_span["input"] == {
                "type": "chat_messages",
                "value": [
                    {"role": "system", "content": template},
                    {"role": "user", "content": "colors"},
                ],
            }
            assert first_span["outputs"] == [
                {
                    "type": "chat_messages",
                    "value": [
                        {"role": "assistant", "content": "red, blue, green, yellow"},
                    ],
                }
            ]
            assert "red, blue, green, yellow" in first_span["raw_response"]
            assert first_span["params"] == {"temperature": 0.7, "stream": False}
            assert first_span["metrics"] == {
                "prompt_tokens": 5,
                "completion_tokens": 16,
            }
            assert first_span["timestamps"]["started_at"] == int(
                datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
            )
            assert first_span["timestamps"]["finished_at"] >= int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )
