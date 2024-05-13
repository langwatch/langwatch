import json
import os
import yaml


def generate_proxy_config():
    # check if file exits
    if not os.path.exists("../models.json"):
        return

    # Read the JSON data from the file (assuming the JSON data is in a file named 'models.json')
    with open("../models.json", "r") as file:
        data = json.load(file)

    # Prepare the YAML data structure
    yaml_data = {"model_list": []}

    for key, value in data.items():
        if key == "openai/gpt-4o":
            model_entry = {"model_name": "*", "litellm_params": {"model": "openai/*"}}
        else:
            model_entry = {"model_name": key, "litellm_params": {"model": key}}
        # Check if the model provider is Azure and add the 'api_base' key
        if key.startswith("azure/"):
            model_entry["litellm_params"]["api_base"] = os.environ.get(
                "AZURE_OPENAI_ENDPOINT", "NOT_SET"
            )

        yaml_data["model_list"].append(model_entry)

    # Save the data to a YAML file
    with open("proxy_config.generated.yaml", "w") as yaml_file:
        yaml.dump(yaml_data, yaml_file, default_flow_style=False)


if __name__ == "__main__":
    generate_proxy_config()
