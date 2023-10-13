from datetime import datetime
import json
import time
from unittest.mock import patch
from freezegun import freeze_time

from langchain.chains import LLMMathChain
from langchain.llms import OpenAI
from langchain.chat_models import ChatOpenAI
from langchain.prompts import PromptTemplate, ChatPromptTemplate
from langchain.schema import (
    BaseOutputParser,
)
from langchain.chains import LLMChain
import openai
import requests_mock

import langwatch
import langwatch.langchain
from langchain.agents import load_tools, initialize_agent, Tool
from langchain.agents.agent import AgentExecutor
from langchain.agents.openai_functions_agent.base import OpenAIFunctionsAgent

from tests.utils import *


class CommaSeparatedListOutputParser(BaseOutputParser):
    """Parse the output of an LLM call to a comma-separated list."""

    def parse(self, text: str):
        """Parse the output of an LLM call."""
        return text.strip().split(", ")


class TestLangChainTracer:
    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_lang_chain_chat_calls(self):
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

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_lang_chain_completion(self):
        with requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})
            mock_request.post(
                "https://api.openai.com/v1/completions",
                json=create_openai_completion_mock("red, blue, green, yellow"),
            )

            template = """You are a helpful assistant who generates comma separated lists.
            A user will pass in a category, and you should generate 5 objects in that category in a comma separated list.
            ONLY return a comma separated list, and nothing more. Make a list of {text}"""

            chat_prompt = PromptTemplate.from_template(template)
            chain = LLMChain(
                llm=OpenAI(),
                prompt=chat_prompt,
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

            assert second_span["type"] == "llm"
            assert second_span["vendor"] == "openai"
            assert second_span["model"] == "text-davinci-003"
            assert second_span["input"] == {
                "type": "json",
                "value": [template.replace("{text}", "colors")],
            }
            assert second_span["outputs"] == [
                {
                    "type": "text",
                    "value": "red, blue, green, yellow",
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

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_lang_chain_streaming_chat_calls(self):
        with patch.object(
            openai.ChatCompletion,
            "create",
            side_effect=[
                create_openai_chat_completion_stream_mock(
                    ["red,", " blue,", " green,", " yellow"]
                ),
            ],
        ), requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})

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
                llm=ChatOpenAI(streaming=True),
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
            assert second_span["params"] == {"temperature": 0.7, "stream": True}
            assert "metrics" not in second_span
            assert second_span["timestamps"]["started_at"] == int(
                datetime(2022, 1, 1, 0, 0, 15).timestamp() * 1000
            )
            assert second_span["timestamps"]["finished_at"] >= int(
                datetime(2022, 1, 1, 0, 0, 30).timestamp() * 1000
            )

    @freeze_time("2022-01-01", auto_tick_seconds=15)
    def test_trace_agents_functions_and_tools(self):  # TODO: test without functions?
        with requests_mock.Mocker() as mock_request:
            mock_request.post(langwatch.endpoint, json={})
            mock_request.post(
                "https://api.openai.com/v1/chat/completions",
                [
                    {
                        "json": {
                            "choices": [
                                {
                                    "finish_reason": "function_call",
                                    "index": 0,
                                    "message": {
                                        "content": None,
                                        "function_call": {
                                            "arguments": '{\n  "__arg1": "2+2"\n}',
                                            "name": "Calculator",
                                        },
                                        "role": "assistant",
                                    },
                                }
                            ],
                            "created": 1697189473,
                            "id": "chatcmpl-898nhOctWsU6TpiJYEsrwcAHj1sSN",
                            "model": "gpt-3.5-turbo-0613",
                            "object": "chat.completion",
                            "usage": {
                                "completion_tokens": 19,
                                "prompt_tokens": 66,
                                "total_tokens": 85,
                            },
                        }
                    },
                    {
                        "json": create_openai_chat_completion_mock(
                            '```text\n2 + 2\n```\n...numexpr.evaluate("2 + 2")...\n'
                        )
                    },
                    {
                        "json": create_openai_chat_completion_mock(
                            "2 + 2 is equal to 4."
                        )
                    },
                ],
            )

            llm = ChatOpenAI()
            llm_math_chain = LLMMathChain.from_llm(llm=llm, verbose=True)
            tools = [
                Tool(
                    name="Calculator",
                    func=llm_math_chain.run,
                    description="useful for when you need to answer questions about math",
                ),
            ]
            agent = AgentExecutor.from_agent_and_tools(
                agent=OpenAIFunctionsAgent.from_llm_and_tools(
                    llm,
                    tools,
                    verbose=True,
                ),
                tools=tools,
                verbose=True,
            )

            with langwatch.langchain.LangChainTracer() as langWatchCallback:
                result = agent.run("how much is 2+2?", callbacks=[langWatchCallback])
            print("\n\nresult\n\n", result)

            assert result == "2 + 2 is equal to 4."

            time.sleep(0.01)
            request_history = [
                r for r in mock_request.request_history if "langwatch" in r.url
            ]
            # print(
            #     "\n\nrequest_history[0].json()\n\n",
            #     json.dumps(request_history[0].json(), indent=2),
            # )
            spans = request_history[0].json()["spans"]

            first_llm_call = [span for span in spans if span["type"] == "llm"][0]

            assert first_llm_call["params"]["functions"] == [
                {
                    "name": "Calculator",
                    "description": "useful for when you need to answer questions about math",
                    "parameters": {
                        "properties": {"__arg1": {"title": "__arg1", "type": "string"}},
                        "required": ["__arg1"],
                        "type": "object",
                    },
                }
            ]

            calculator_tool = [
                span
                for span in spans
                if span["type"] == "tool"
                and "name" in span
                and span["name"] == "Calculator"
            ][0]
            assert calculator_tool["outputs"] == [
                {"type": "text", "value": "Answer: 4"}
            ]

            calculator_agent = [
                span
                for span in spans
                if span["type"] == "agent"
                and "name" in span
                and span["name"] == "Calculator"
            ][0]
            assert calculator_agent["outputs"] == [
                {"type": "json", "value": {"output": "2 + 2 is equal to 4."}}
            ]

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
