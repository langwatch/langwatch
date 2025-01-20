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
    # return {"output": response}

    return {
        "output": "Hello! How can I help you today?",
    }


# Instantiate the BatchEvaluation object
evaluation = BatchEvaluation(
    dataset="test-custim",
    evaluations=[
        "test-eval",
    ],
    callback=callback,
)

# Run the evaluation
results = evaluation.run()
