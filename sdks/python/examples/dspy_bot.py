import os
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch

import dspy


lm = dspy.LM("openai/gpt-4o-mini", api_key=os.environ["OPENAI_API_KEY"])

dspy.settings.configure(lm=lm)


class GenerateAnswer(dspy.Signature):
    """Answer questions with careful explanations to the user."""

    context = dspy.InputField(desc="may contain relevant facts")
    question = dspy.InputField()
    answer = dspy.OutputField(desc="markdown formatted answer, use some emojis")


class RAG(dspy.Module):
    def __init__(self):
        super().__init__()

        self.generate_answer = dspy.ChainOfThought(GenerateAnswer)

    def forward(self, question):
        context = ["This is a test context"]
        prediction = self.generate_answer(question=question, context=context)
        return dspy.Prediction(answer=prediction.answer)


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().autotrack_dspy()
    langwatch.get_current_trace().update(
        metadata={"labels": ["dspy", "thread"], "thread_id": "90210"},
    )

    msg = cl.Message(
        content="",
    )

    program = RAG()
    prediction = program(question=message.content)

    await msg.stream_token(prediction.answer)
    await msg.update()

    return prediction.answer
