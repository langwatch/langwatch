from dotenv import load_dotenv

load_dotenv()
from langwatch.batch_evaluation import BatchEvaluation, DatasetEntry
import pandas as pd

df = pd.DataFrame(
    {
        "input": ["Hello, world!", "Hello, world!", "Hello, world!"],
        "output": ["Hello, world!", "Hello, world!", "Hello, world!"],
    }
)

eval = {
    "evaluator": "langevals/llm_boolean",
    "settings": {
        "model": "atla/atla-selene",
        "max_tokens": 8192,
        "prompt": "foo bar baz",
    },
}


def callback(entry: DatasetEntry):
    # generate messages for entry["input"] using your LLM
    # input_data = entry["input"]
    # Assuming the dataset contains an "input" column

    # Process the input data using your LLM and generate a response
    # response = f"Generated response for input: {input_data}"
    # print(response)
    # return {"output": response}

    return {"output": entry["output"], "input": entry["input"]}


# Instantiate the BatchEvaluation object
evaluation = BatchEvaluation(
    experiment="My Experiment2",
    dataset="summary-test",
    dataset2=df,
    evaluations=["ragas-response-relevancy"],
    evaluations2=[eval],
    callback=callback,
)

# Run the evaluation
results = evaluation.run()
