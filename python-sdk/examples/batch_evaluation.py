from langwatch.batch_evaluation import BatchEvaluation, DatasetEntry

# export LANGWATCH_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0aW1lc3RhbXAiOjE2OTgwMDI0NDUwODgsInJhbmQiOjAuNzkxMTQ3NzM2NDIyMTcwNCwiaWF0IjoxNjk4MDAyNDQ1fQ.pcJqTXUnE-t1xZc1fJ6AMFh_NGadmdxA1If-YGl-ILM
# export LANGWATCH_API_KEY=sk-lw-gMWSLSCQX79E8cLqfA9SxMul4GfwnYhEj0NHdNUMQrbB6R6G
# export LANGWATCH_ENDPOINT=http://localhost:5560


def callback(entry: DatasetEntry):
    # generate messages for entry["input"] using your LLM
    # input_data = entry["input"]
    # Assuming the dataset contains an "input" column

    # Process the input data using your LLM and generate a response
    # response = f"Generated response for input: {input_data}"
    # print(response)

    # Return a more structured response that includes contexts as an array
    try:
        input_data = entry["input"]
    except (KeyError, AttributeError):
        input_data = "No input provided"
    expected_output_data = entry["expected_output"]

    return {
        "input": input_data,  # Include the input data
        "output": "Generated response for the input",
        "expected_output": expected_output_data,
        "contexts": [],  # Empty array for contexts as the evaluation seems to expect this
        "metadata": {
            "source": "callback_function",
            "timestamp": "2024-01-01T00:00:00Z",
        },
    }


# return {}


# Instantiate the BatchEvaluation object
evaluation = BatchEvaluation(
    experiment="Test",
    dataset="knowledge-basevms-2004-classic",  # Changed from draft-dataset-contexts
    evaluations=["llm-answer-match"],  # Remove evaluations to test basic functionality
    callback=callback,
    # max_workers=1,  # Reduce workers to avoid resource cleanup warnings
)

# Run the evaluation
results = evaluation.run()
