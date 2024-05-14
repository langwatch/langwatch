variable "evaluator_package" {
  description = "LangEval evaluator package name to run on the lambda"
  type        = string
}

variable "apigw_execution_arn" {
  description = "ARN of the API Gateway execution role"
  type        = string
}

variable "sns_alarms_topic_arn" {
  description = "SNS topic ARN to send alarms to"
  type        = string
}
