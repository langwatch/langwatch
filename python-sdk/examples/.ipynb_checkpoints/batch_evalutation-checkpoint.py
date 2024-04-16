from dotenv import load_dotenv

load_dotenv()
from langwatch.batch_evaluation import BatchEvaluation, DatasetEntry


def callback(entry: DatasetEntry):
    # generate messages for entry.input using your LLM
    # input_data = entry.get("input")
    # Assuming entry contains an "input" field

    # Process the input data using your LLM and generate a response
    # response = f"Generated response for input: {input_data}"
    # print(response)

    return {"output": "Hello! How can I help you today?"}


# Instantiate the BatchEvaluation object
evaluation = BatchEvaluation(
    dataset="python-test",  # Provide the actual dataset name here
    evaluations=["ragas/answer_relevancy"],
    callback=callback,
    generations="one-shot",
)

# Run the evaluation
evaluation.run()
