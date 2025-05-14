import json
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
from openai import OpenAI
import langwatch

client = OpenAI()


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    msg = cl.Message(
        content="",
    )

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message.content},
        ],
        stream=True,
    )

    final_message = ""
    for part in completion:
        if token := part.choices[0].delta.content or "":
            final_message += token
            await msg.stream_token(token)

    useful_message_evaluation(question=message.content, answer=final_message)

    await msg.update()


@langwatch.span(type="evaluation")
def useful_message_evaluation(question: str, answer: str):
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "Please evaluate the following question and answer pair. Return a score between 0 and 100, where 0 is not useful and 100 is very useful.",
            },
            {"role": "user", "content": f"Question: {question}\nAnswer: {answer}"},
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "useful_message_evaluation",
                    "description": "Evaluate the usefulness of a question and answer pair.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "reasoning": {
                                "type": "string",
                                "description": "Use this field to think through the reasoning for the score.",
                            },
                            "score": {
                                "type": "integer",
                                "description": "The score of the question and answer pair.",
                            },
                        },
                        "required": ["reasoning", "score"],
                    },
                },
            }
        ],
        tool_choice={
            "type": "function",
            "function": {
                "name": "useful_message_evaluation",
            },
        },
    )

    tool_message = completion.choices[0].message.tool_calls[0]  # type: ignore
    arguments = json.loads(tool_message.function.arguments)

    langwatch.get_current_span().add_evaluation(
        name="Useful Message Evaluation",
        passed=arguments["score"] > 50,
        score=arguments["score"],
        details=arguments["reasoning"],
    )
