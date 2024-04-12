import nanoid
import langwatch
import httpx


class BatchEvaluation:
    def __init__(self, dataset, evaluations, callback=None, generations="one-shot"):
        self.dataset = dataset
        self.evaluations = evaluations
        self.callback = callback
        self.generations = generations

    def run(self):
        # Start the evaluation process
        print("Starting batch evaluation...")
        batchId = generate_id()

        dataset = get_dataset(self.dataset)
        if dataset is None:
            print(f"Dataset {self.dataset} not found.")
            return

        # Execute evaluations for each dataset
        for evaluation in self.evaluations:
            print(f"Evaluating {evaluation} on dataset {self.dataset}...")

            # if is array and has data
            if isinstance(dataset, list) and len(dataset) > 0:
                # loop through the dataset
                for data in dataset:
                    entry_data = data.get("entry")
                    if isinstance(
                        entry_data, dict
                    ):  # Check if entry_data is a dictionary
                        print("ed", entry_data)
                        if self.callback:
                            self.callback(entry_data)

            # Perform evaluation steps here...

        # Finish the evaluation process
        print("Batch evaluation completed.")

        # Call the callback function to indicate completion if provided
        if self.callback:
            self.callback("Batch evaluation completed.")


def generate_id():
    id_prefix = "batch_"
    id_suffix = nanoid.generate(size=10)
    return id_prefix + id_suffix


def run_evaluation(data: dict, evaluation: str, batch_id: str, datasetSlug: str):

    input_data = data.get("input", "")
    output_data = data.get("output", "")
    contexts_data = data.get("contexts", [])
    expected_output_data = data.get("expected_output", "")

    request_params = {
        "url": langwatch.endpoint + f"/api/dataset/evaluate",
        "headers": {"X-Auth-Token": str(langwatch.api_key)},
        "json": {
            "data": {
                "input": input_data,
                "output": output_data,
                "contexts": contexts_data,
                "expected_output": expected_output_data,
            },
            "evaluation": evaluation,
            "batch_id": batch_id,
            "datasetSlug": datasetSlug,
        },
    }
    with httpx.Client() as client:
        response = client.post(**request_params)
        response.raise_for_status()

    return handle_response(response)


def get_dataset(
    slug: str,
):

    request_params = {
        "url": langwatch.endpoint + f"/api/dataset/{slug}",
        "headers": {"X-Auth-Token": str(langwatch.api_key)},
    }
    with httpx.Client() as client:
        response = client.get(**request_params)
        response.raise_for_status()

    return handle_response(response)


def handle_response(response):

    result = response.json()

    if "status" in result and result["status"] == "error":
        # If the response contains a status key and its value is "error"
        error_message = result.get("message", "Unknown error")
        # Get the error message if available, otherwise set it to "Unknown error"
        return f"Error: {error_message}"
    else:
        # If the response does not contain a status key or its value is not "error"
        return result.get("data", None)
        # Return the data or None if data is not available
