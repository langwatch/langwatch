output "lambda_arn" {
  description = "value of the lambda function ARN"
  value       = length(aws_lambda_function.this) > 0 ? aws_lambda_function.this[0].arn : null
}

output "lambda_invoke_arn" {
  description = "value of the lambda function ARN"
  value       = length(aws_lambda_function.this) > 0 ? aws_lambda_function.this[0].invoke_arn : null
}
