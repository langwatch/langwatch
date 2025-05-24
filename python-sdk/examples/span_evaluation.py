from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl
import openai
from openai import OpenAI
import langwatch
from pydantic import BaseModel


client = OpenAI()

user_bios = [
    "Hello, my name is Richard and I am a software engineer, I'm 30 years old from New York.",
    "My name is Rogerio, I was born in 1992 in Brazil and I love to play soccer.",
    "Hi I'm Manouk, I'm Dutch, 25 years old and I love to travel.",
]


class GetBioInfo(BaseModel):
    name: Optional[str] = None
    profession: Optional[str] = None
    year_of_birth: Optional[int] = None
    country: Optional[str] = None


class GetBioInfoList(BaseModel):
    bio_infos: list[GetBioInfo]


async def extract_structured_user_bios(user_bios: list[str]) -> GetBioInfoList:
    completion = client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": f"You are a helpful assistant that helps extracts information from a list of user bio in a json list structure. Year of birth should be calculated based on the current year and the age, and fields not identified should be set to null. Current year is {datetime.now().year}.",
            },
            {"role": "user", "content": "\n".join(user_bios)},
        ],
        tools=[openai.pydantic_function_tool(GetBioInfoList)],
        tool_choice="required",
    )

    get_bio_info_list: GetBioInfoList = completion.choices[0].message.tool_calls[0].function.parsed_arguments  # type: ignore

    await langwatch.get_current_span().async_evaluate(
        "ragas/faithfulness",
        name="Faithfulness",
        output=str(get_bio_info_list),
        contexts=user_bios,
        settings={
            "model": "openai/gpt-3.5-turbo-16k",
            "embeddings_model": "openai/text-embedding-ada-002",
            "max_tokens": 2048,
        },
    )

    return get_bio_info_list


class GeneratePythonCode(BaseModel):
    code: str


@langwatch.span(type="tool")
async def generate_and_execute_code(
    msg: cl.Message, question: str, bio_info_list: GetBioInfoList
) -> tuple[str, str]:
    completion = client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": f"""
                You generate code to answer user question based on the bio info list provided.

                Generate a piece of python code that will be evaluated to help answer user questions. If no code is needed, just emit `return ""`

                You just need to generate the inner body of the function, the code starts with:

                ```python
                {bio_info_list}

                def answer_result_helper():
                """,
            },
            {"role": "user", "content": question},
        ],
        tools=[openai.pydantic_function_tool(GeneratePythonCode)],
        tool_choice="required",
    )

    code = completion.choices[0].message.tool_calls[0].function.parsed_arguments.code  # type: ignore
    indented_code = code.replace("\n", "\n    ")

    code_to_execute = f"""
def answer_result_helper():
    {indented_code}
"""

    await msg.stream_token(f"```python\n{code_to_execute}\n```\n\n")

    code_error = False
    try:
        result = execute_code(code_to_execute, bio_info_list)
    except Exception as e:
        code_error = True
        result = str(e)

    langwatch.get_current_span().add_evaluation(
        name="Valid Python Code",  # required
        passed=not code_error,
        details=result if code_error else None,
        cost={"currency": "USD", "amount": 1.5},
    )

    return code_to_execute, result


@langwatch.span()
def execute_code(code: str, bio_info_list: GetBioInfoList) -> str:
    safe_builtins = dict(__builtins__)

    # Remove potentially unsafe functions
    unsafe_functions = [
        "eval",
        "exec",
        "compile",
        "__import__",
        "open",
        "input",
        "breakpoint",
    ]
    for func in unsafe_functions:
        safe_builtins.pop(func, None)

    locals = {}
    safe_globals_ = {
        "__builtins__": safe_builtins,
        "bio_infos": bio_info_list.bio_infos,
    }

    exec(code, safe_globals_, locals)

    return locals["answer_result_helper"]()  # type: ignore


@langwatch.span()
async def answer_user(
    question: str,
    code: str,
    result: str,
):
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "user",
                "content": f"""
            The user asked this question: {question}
            We executed this code to answer the question:
            ```python
            {code}
            ```
            The result of the code is:
            ```python
            {result}
            ```
            Now, you need to answer the user question based on the result of the code.
            """,
            },
        ],
    )

    return completion.choices[0].message.content or ""


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"labels": ["custom_evaluation"]},
    )

    # Example: "who is the oldest person?"
    question = message.content

    msg = cl.Message(
        content="",
    )

    bio_info_list = await extract_structured_user_bios(user_bios)

    await msg.stream_token(f"```python\n{bio_info_list}\n```\n\n")

    code, result = await generate_and_execute_code(msg, question, bio_info_list)

    await msg.stream_token(f"Result:\n```python\n{result}\n```\n\n")

    answer = await answer_user(question, code, result)

    await langwatch.get_current_trace().async_evaluate(
        "ragas/answer_correctness",
        name="Answer Correctness",
        input=question,
        output=answer,
        expected_output="Rogerio",
        settings={
            "model": "openai/gpt-3.5-turbo-16k",
            "embeddings_model": "openai/text-embedding-ada-002",
            "max_tokens": 2048,
        },
    )

    await msg.stream_token(answer)

    await msg.update()
