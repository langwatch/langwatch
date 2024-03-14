provider "aws" {
  region = "eu-central-1"
  profile = "lw-root-tf"
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "evaluators-api"
  description = "Langwatch evaluators API"
}

resource "aws_api_gateway_deployment" "this" {
  depends_on = [
    module.example-api-gw,
  ]

  rest_api_id = "${aws_api_gateway_rest_api.this.id}"
  stage_name  = "prod"
}

# Path: infrastructure/lambda/main.tf
module "example-eval" {
  source = "./lambda"

  environment = "dev"
  function_name = "evaluator"
  function_handler = "langevals_example.word_count.ExampleWordCountEvaluator.run_evaluation"
  source_code_dir = "../langevals/evaluators/example"
  layers_dir = "../layers"

  apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
}

resource "aws_api_gateway_resource" "example" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "example"
}

resource "aws_api_gateway_resource" "word_count" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.example.id
  path_part   = "word_count"
}

module "example-api-gw" {
  source = "./api-gw-resource"
  apigw_id = aws_api_gateway_rest_api.this.id
  apigw_root_resource_id = aws_api_gateway_resource.word_count.id
  path = "evaluate"
  method = "POST"

  lambda_invoke_arn = module.example-eval.lambda_invoke_arn
}
