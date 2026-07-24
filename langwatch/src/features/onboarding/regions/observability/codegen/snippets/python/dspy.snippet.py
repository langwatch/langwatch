import langwatch  # +
import dspy
import os

langwatch.setup()  # +

# Initialize your DSPy LM (Language Model)
lm = dspy.LM(
    "openai/gpt-5",
    api_key=os.environ.get("OPENAI_API_KEY"),
    temperature=1.0,
    max_tokens=16000,
)
dspy.settings.configure(lm=lm)


@langwatch.trace(name="DSPy RAG Execution")
def run_dspy_program(user_query: str):
    langwatch.get_current_trace().autotrack_dspy()  # +

    module = dspy.Predict("question -> answer")
    prediction = module(question=user_query)
    return prediction.answer


def main():
    user_question = "What is the capital of France?"
    response = run_dspy_program(user_question)
    print(f"Question: {user_question}")
    print(f"Answer: {response}")


if __name__ == "__main__":
    main()
