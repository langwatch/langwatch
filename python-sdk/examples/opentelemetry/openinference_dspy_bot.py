import os
import dspy
from dotenv import load_dotenv

import langwatch

load_dotenv()

import chainlit as cl

from openinference.instrumentation.dspy import DSPyInstrumentor

langwatch.setup(
    instrumentors=[DSPyInstrumentor()],
)

llm = dspy.OpenAI(
    model="gpt-4o-mini",
    max_tokens=2048,
    temperature=0,
    api_key=os.environ["OPENAI_API_KEY"],
)

colbertv2_wiki17_abstracts = dspy.ColBERTv2(
    url="http://20.102.90.50:2017/wiki17_abstracts"
)

dspy.settings.configure(lm=llm, rm=colbertv2_wiki17_abstracts)


class GenerateAnswer(dspy.Signature):
    """Answer questions with short factoid answers."""

    context = dspy.InputField(desc="may contain relevant facts")
    question = dspy.InputField()
    answer = dspy.OutputField(desc="often between 1 and 5 words")


class RAG(dspy.Module):
    def __init__(self, num_passages=3):
        super().__init__()

        self.retrieve = dspy.Retrieve(k=num_passages)
        self.generate_answer = dspy.ChainOfThought(GenerateAnswer)

    def forward(self, question):
        context = self.retrieve(question).passages  # type: ignore
        prediction = self.generate_answer(question=question, context=context)
        return dspy.Prediction(answer=prediction.answer)


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    program = RAG()
    program = program.reset_copy()
    prediction = program(question=message.content)

    await msg.stream_token(prediction.answer)
    await msg.update()
