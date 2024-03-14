variable "environment" {
  description = "Environment that the resource created in"
  type        = string
}

variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "function_handler" {
  description = "Lambda function handler"
  type        = string
}


variable "source_code_dir" {
  description = "Directory where the source code lives in"
  type        = string
}

variable "layers_dir" {
  description = "Directory where the dependencies are installed in"
  type        = string
}

variable "apigw_execution_arn" {
  description = "ARN of the API Gateway execution role"
  type        = string
}
