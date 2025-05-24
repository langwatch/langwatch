import os
from dotenv import load_dotenv

load_dotenv()

import chainlit as cl

import langwatch

import dspy


lm = dspy.LM("openai/gpt-4o-mini", api_key=os.environ["OPENAI_API_KEY"])

colbertv2_wiki17_abstracts = dspy.ColBERTv2(
    url="http://20.102.90.50:2017/wiki17_abstracts"
)

dspy.settings.configure(lm=lm, rm=colbertv2_wiki17_abstracts)


class GenerateAnswer(dspy.Signature):
    """Answer questions with careful explanations to the user."""

    context = dspy.InputField(desc="may contain relevant facts")
    question = dspy.InputField()
    answer = dspy.OutputField(desc="markdown formatted answer, use some emojis")


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
