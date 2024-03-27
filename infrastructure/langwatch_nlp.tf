locals {
  langwatch_nlp_tag         = data.external.langwatch_nlp_git_tag.result["tag"]
  langwatch_nlp_secrets_map = jsondecode(data.aws_secretsmanager_secret_version.langwatch_nlp.secret_string)
}

data "external" "langwatch_nlp_git_tag" {
  program = ["${path.root}/scripts/get_langwatch_nlp_git_sha.sh"]
}

resource "aws_ecr_repository" "langwatch_nlp" {
  name                 = "langwatch_nlp"
  image_tag_mutability = "IMMUTABLE"
}

data "aws_ecr_repository" "langwatch_nlp" {
  name = aws_ecr_repository.langwatch_nlp.name
}

resource "aws_lambda_function" "langwatch_nlp" {
  count         = module.variables.profile == "lw-prod" ? 1 : 0
  package_type  = "Image"
  function_name = "langwatch-nlp-lambda"
  image_uri     = "${aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}"
  role          = aws_iam_role.langwatch_nlp.arn
  timeout       = 60

  # use `/usr/bin/time -alh make start` to get the memory usage (maximum resident set size in bytes)
  memory_size = 1024

  environment {
    variables = local.langwatch_nlp_secrets_map
  }

  depends_on = [
    aws_iam_role_policy_attachment.langwatch_nlp,
    null_resource.langwatch_nlp_docker_image,
    aws_cloudwatch_log_group.langwatch_nlp
  ]
}

resource "aws_cloudwatch_metric_alarm" "langwatch_nlp_function_errors" {
  count               = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name          = "langwatch-nlp-lambda-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = "1"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "60"
  statistic           = "Sum"
  threshold           = "1"
  alarm_description   = "Alarm when langwatch-nlp lambda has errors"
  actions_enabled     = true
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    FunctionName = aws_lambda_function.langwatch_nlp[0].function_name
  }

  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_log_group" "langwatch_nlp" {
  name              = "/aws/lambda/langwatch-nlp-lambda"
  retention_in_days = 365
}

resource "aws_lambda_function_url" "langwatch_nlp" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  function_name      = aws_lambda_function.langwatch_nlp[0].function_name
  authorization_type = "NONE"
}

data "aws_lambda_function_url" "langwatch_nlp" {
  count         = module.variables.profile == "lw-prod" ? 1 : 0
  function_name = aws_lambda_function_url.langwatch_nlp[0].function_name
}

resource "null_resource" "langwatch_nlp_docker_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  triggers = {
    image_hash = local.langwatch_nlp_tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building LangWatch NLP..."
      cd ../langwatch/langwatch_nlp
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      last_tag=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} describe-images --repository-name ${aws_ecr_repository.langwatch_nlp.name} \
        --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]' --output yaml \
        | tail -n 1 | awk -F'- ' '{print $2}')
      set -e
      cache_from=""
      if [ -n "$last_tag" ]; then
        cache_from="--cache-from ${aws_ecr_repository.langwatch_nlp.repository_url}:$last_tag"
      fi

      docker build . -f Dockerfile.lambda --platform="linux/amd64" $cache_from -t ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}
      docker push ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}
      cd -
    EOT

    on_failure = fail
  }

  depends_on = [aws_ecr_repository.langwatch_nlp]
}

# IAM role which dictates what other AWS services the Lambda function
# may access.
resource "aws_iam_role" "langwatch_nlp" {
  name = "langwatch-nlp-lambda-role"

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

resource "aws_iam_policy" "langwatch_nlp" {
  name        = "langwatch-nlp-lambda-policy"
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

resource "aws_iam_role_policy_attachment" "langwatch_nlp" {
  role       = aws_iam_role.langwatch_nlp.name
  policy_arn = aws_iam_policy.langwatch_nlp.arn
}
