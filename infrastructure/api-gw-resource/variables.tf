variable "apigw_id" {
  description = "API Gateway ID"
  type        = string
}

variable "apigw_root_resource_id" {
  description = "API Gateway root resource ID"
  type        = string
}

variable "path" {
  description = "Full path of the resource"
  type        = string
}

variable "method" {
  description = "HTTP method"
  type = string
}

variable "lambda_invoke_arn" {
  description = "ARN of the Lambda function to be invoked"
  type        = string
}