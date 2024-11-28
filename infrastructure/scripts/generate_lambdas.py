# import sys

# sys.path.append("../langevals")

import inspect
import json
import os
import textwrap
from typing import Any, Dict, Literal, Optional, Union, get_args, get_origin

from pydantic import BaseModel
from langevals.utils import (
    EvaluatorDefinitions,
    get_evaluator_classes,
    get_evaluator_definitions,
    load_evaluator_packages,
)


def main():
    evaluators = load_evaluator_packages()

    depends_on = []
    lambdas_tf = ""

    for _, evaluator_module in evaluators.items():
        package_name = evaluator_module.__name__.split("langevals_")[1]
        if package_name == "example":
            continue

        for evaluator_cls in get_evaluator_classes(evaluator_module):
            definitions = get_evaluator_definitions(evaluator_cls)
            evaluator_name = definitions.evaluator_name
            lambdas_tf += f"""
            resource "aws_api_gateway_resource" "{package_name}-{evaluator_name}" {{
                rest_api_id = aws_api_gateway_rest_api.langevals.id
                parent_id   = aws_api_gateway_resource.{package_name}.id
                path_part   = "{evaluator_name}"
            }}

            module "{package_name}-{evaluator_name}-api-gw" {{
                source                 = "./api-gw-resource"
                apigw_id               = aws_api_gateway_rest_api.langevals.id
                apigw_root_resource_id = aws_api_gateway_resource.{package_name}-{evaluator_name}.id
                path                   = "evaluate"
                method                 = "POST"

                lambda_invoke_arn = module.{package_name}-evaluator.lambda_invoke_arn

                depends_on = [
                    aws_api_gateway_resource.{package_name}-{evaluator_name}
                ]
            }}
            """
            depends_on.append(f"module.{package_name}-{evaluator_name}-api-gw")

        lambdas_tf += f"""
            module "{package_name}-evaluator" {{
                source              = "./lambda"
                evaluator_package   = "{package_name}"
                sns_alarms_topic_arn = aws_sns_topic.alarms.arn
                apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
            }}

            resource "aws_api_gateway_resource" "{package_name}" {{
                rest_api_id = aws_api_gateway_rest_api.langevals.id
                parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
                path_part   = "{package_name}"
            }}
            """

    lambdas_tf += f"""
            resource "aws_api_gateway_deployment" "this" {{
                count = module.variables.profile == "lw-prod" ? 1 : 0

                triggers = {{
                    redeployment = sha1(jsonencode([{", ".join(depends_on)}]))
                }}

                depends_on = [
                    {", ".join(depends_on)}
                ]

                rest_api_id = aws_api_gateway_rest_api.langevals.id
            }}
            """

    with open("../infrastructure/lambdas.generated.tf", "w") as tf_file:
        tf_file.write(textwrap.dedent(lambdas_tf))

    print("Terraform Lambdas generated successfully.")


if __name__ == "__main__":
    main()
