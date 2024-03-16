variable "evaluator_package" {
  description = "LangEval evaluator package name to run on the lambda"
  type        = string
}

variable "apigw_execution_arn" {
  description = "ARN of the API Gateway execution role"
  type        = string
}

variable "environment_variables" {
  description = "Environment variables for the lambda"
  type        = map(string)
}
