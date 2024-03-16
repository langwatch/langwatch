output "lambda_arn" {
  description = "value of the lambda function ARN"
  value = aws_lambda_function.this.arn
}

output "lambda_invoke_arn" {
  description = "value of the lambda function ARN"
  value = aws_lambda_function.this.invoke_arn
}