locals {
  resource_name         = var.evaluator_package
  zipped_lambda_package = "${path.root}/../langevals/dist/lambdas/${var.evaluator_package}.zip"
}

resource "aws_lambda_function" "this" {
  function_name = "${local.resource_name}-evaluator-lambda"

  filename         = local.zipped_lambda_package
  source_code_hash = filebase64sha256(local.zipped_lambda_package)

  handler = "langevals.server.handler"
  runtime = "python3.11"

  role = aws_iam_role.lambda.arn

  depends_on = [
    aws_iam_role_policy_attachment.lambda
  ]
}

resource "aws_lambda_layer_version" "this" {
  filename            = local.zipped_lambda_package
  layer_name          = "${local.resource_name}--python3-layer"
  source_code_hash    = filebase64sha256(local.zipped_lambda_package)
  compatible_runtimes = ["python3.11"]
}


# IAM role which dictates what other AWS services the Lambda function
# may access.
resource "aws_iam_role" "lambda" {
  name = "${local.resource_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Effect = "Allow",
        Sid    = ""
      }
    ]
  })
}

resource "aws_iam_policy" "lambda" {
  name        = "${local.resource_name}-lambda-policy"
  path        = "/"
  description = "AWS IAM Policy for managing aws lambda role"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = [
          "arn:aws:logs:*:*:*",
          "arn:aws:secretsmanager:*:*:secret:*"
        ]
        Effect = "Allow"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.lambda.arn
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"

  # The /*/* portion grants access from any method on any resource
  # within the API Gateway "REST API".
  source_arn = "${var.apigw_execution_arn}/*/*"
}
