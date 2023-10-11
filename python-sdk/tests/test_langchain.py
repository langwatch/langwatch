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
            with langwatch.langchain.LangChainTracer() as langWatchCallback:
                result = chain.run(text="colors", callbacks=[langWatchCallback])
            assert result == "red, blue, green, yellow"

            time.sleep(0.01)
            request_history = [
                r for r in mock_request.request_history if "langwatch" in r.url
            ]
            first_span, second_span = request_history[0].json()["spans"]

            assert first_span["type"] == "chain"
            assert first_span["trace_id"].startswith("trace_")
            assert first_span["parent_id"] == None
            assert first_span["timestamps"]["started_at"] == int(
                datetime(2022, 1, 1, 0, 0, 0).timestamp() * 1000
            )
            assert first_span["timestamps"]["finished_at"] >= int(
                datetime(2022, 1, 1, 0, 0, 45).timestamp() * 1000
            )

            assert second_span["type"] == "llm"
            assert second_span["trace_id"].startswith("trace_")
            assert second_span["span_id"].startswith("span_")
            assert second_span["parent_id"] == first_span["span_id"]
            assert second_span["vendor"] == "openai"
            assert second_span["model"] == "gpt-3.5-turbo"
            assert second_span["input"] == {
                "type": "chat_messages",
                "value": [
                    {"role": "system", "content": template},
                    {"role": "user", "content": "colors"},
                ],
            }
            assert second_span["outputs"] == [
                {
                    "type": "chat_messages",
                    "value": [
                        {"role": "assistant", "content": "red, blue, green, yellow"},
                    ],
                }
            ]
            assert "red, blue, green, yellow" in second_span["raw_response"]
            assert second_span["params"] == {"temperature": 0.7, "stream": False}
            assert second_span["metrics"] == {
                "prompt_tokens": 5,
                "completion_tokens": 16,
            }
            assert second_span["timestamps"]["started_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )
            assert second_span["timestamps"]["finished_at"] >= int(
                datetime(2022, 1, 1, 0, 0, 30).timestamp() * 1000
            )

    def test_trace_errors(self):
        with requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})
            mock_request.post(
                "https://api.openai.com/v1/chat/completions",
                status_code=500,
                text="An error occurred!",
            )

            chain = LLMChain(
                llm=ChatOpenAI(max_retries=0),
                prompt=ChatPromptTemplate.from_messages(
                    [
                        ("human", "hi there"),
                    ]
                ),
            )
            with langwatch.langchain.LangChainTracer() as langWatchCallback:
                try:
                    chain.run(text="hi", callbacks=[langWatchCallback])
                except:
                    pass

            time.sleep(0.01)
            request_history = [
                r for r in mock_request.request_history if "langwatch" in r.url
            ]
            first_span, second_span = request_history[0].json()["spans"]

            assert "An error occurred!" in first_span["error"]["message"]
            assert "An error occurred!" in second_span["error"]["message"]
