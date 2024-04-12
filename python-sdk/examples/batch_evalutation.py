from langwatch.batchevaluation import BatchEvaluation


def callback(entry):
    # generate messages for entry.input using your LLM
    print("w", entry.get("input"))
    # input_data = entry.get("input")
    # Assuming entry contains an "input" field

    # Process the input data using your LLM and generate a response
    # response = f"Generated response for input: {input_data}"
    # print(response)
    pass


# Instantiate the BatchEvaluation object
evaluation = BatchEvaluation(
    dataset="python-test",  # Provide the actual dataset name here
    evaluations=["azure/jailbreak"],
    callback=callback,
    generations="one-shot",
)

# Run the evaluation
evaluation.run()
