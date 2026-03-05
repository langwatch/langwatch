import litellm
from litellm.cost_calculator import completion_cost
from litellm.utils import get_max_tokens
from litellm import Choices, Message
from litellm.files.main import ModelResponse
from litellm.utils import trim_messages
from pydantic import Field
from typing import List, Optional, Literal, cast
import os
import json

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluatorEntry,
    ConversationEntry,
    EvaluationResult,
    EvaluatorSettings,
    LLMEvaluatorSettings,
    SingleEvaluationResult,
    EvaluationResultSkipped,
    Money,
)


class QueryResolutionEntry(EvaluatorEntry):
    conversation: List[ConversationEntry]


class QueryResolutionSettings(LLMEvaluatorSettings):
    pass # maybe specify after how many turns we should run this evaluator?


class QueryResolutionResult(EvaluationResult):
    score: float
    passed: bool = Field(default=True)
    details: Optional[str] = Field(default=None)


class QueryResolutionEvaluator(
    BaseEvaluator[
        QueryResolutionEntry,
        QueryResolutionSettings,
        QueryResolutionResult,
    ]
):
    """
    This evaluator checks if all the user queries in the conversation were resolved. Useful to detect when the bot doesn't know how to answer or can't help the user.
    """

    name = "Query Resolution"
    category = "quality"
    env_vars = []
    is_guardrail = False

    def evaluate(
        self, entry: QueryResolutionEntry
    ) -> SingleEvaluationResult:
        vendor, model = self.settings.model.split("/")
        if vendor == "azure":
            os.environ["AZURE_API_KEY"] = self.get_env("AZURE_API_KEY")
            os.environ["AZURE_API_BASE"] = self.get_env("AZURE_API_BASE")
            os.environ["AZURE_API_VERSION"] = "2023-12-01-preview"

        content = entry.conversation or []
        conversation = ""
        counter = 0
        for message in content:
            if message.input == "":
                counter += 1
            conversation_turn = f"USER: {message.input}\n ASSISTANT: {message.output}\n"
            conversation += conversation_turn
        if counter == len(content):
            return EvaluationResultSkipped(details="The conversation is empty")
        litellm_model = model if vendor == "openai" else f"{vendor}/{model}"
        prompt = f"You are an accurate Query Resolution Evaluator. Your goal is to find out if all of the user querries were resolved in the conversation with the chatbot."

        max_tokens_retrieved = get_max_tokens(litellm_model)
        if max_tokens_retrieved is None:
            raise ValueError("Model not mapped yet, cannot retrieve max tokens.")
        llm_max_tokens: int = int(max_tokens_retrieved)
        max_tokens = (
            min(self.settings.max_tokens, llm_max_tokens)
            if self.settings.max_tokens
            else llm_max_tokens
        )
        messages = [
            {
                "role": "system",
                "content": prompt,
            },
            {
                "role": "user",
                "content": conversation,
            },
        ]
        messages = cast(
            List[dict[str, str]],
            trim_messages(messages, litellm_model, max_tokens=max_tokens),
        )

        response = litellm.completion(
            model=litellm_model,
            messages=messages,
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "query_resolution_evaluator",
                        "description": "Evaluate if all of the queries were answered",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "reasoning": {
                                    "type": "string",
                                    "description": "Reasoning for the answer",
                                },
                                "queries_total": {
                                    "type": "number",
                                    "description": "Number of total user queries in the dialogue, greetings and non-requests do not count",
                                },
                                "queries_answered": {
                                    "type": "number",
                                    "description": "Number of resolved user queries in the dialogue",
                                },
                            },
                            "required": [
                                "reasoning",
                                "queries_total",
                                "queries_answered",
                            ],
                        },
                    },
                },
            ],
            tool_choice={
                "type": "function",
                "function": {"name": "query_resolution_evaluator"},
            },
        )
        response = cast(ModelResponse, response)
        choice = cast(Choices, response.choices[0])
        arguments = json.loads(
            cast(Message, choice.message).tool_calls[0].function.arguments
        )

        cost = completion_cost(completion_response=response, prompt=prompt)

        reasoning: str = arguments["reasoning"]
        passed: bool = arguments["queries_answered"] == arguments["queries_total"]
        total_queries: int = arguments["queries_total"]
        resolved_queries: int = arguments["queries_answered"]
        resolution_ratio: float = (
            1
            if resolved_queries == 0 and total_queries == 0
            else resolved_queries / max(total_queries, 1)
        )
        cost = completion_cost(completion_response=response)
        details: str = (
            f"There were {total_queries} queries in total and {resolved_queries} of them were resolved in the conversation. Reasoning: {reasoning}"
        )

        return QueryResolutionResult(
            passed=passed,
            score=resolution_ratio,
            details=details,
            cost=Money(amount=cost, currency="USD") if cost else None,
        )
