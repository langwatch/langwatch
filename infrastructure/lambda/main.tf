module "variables" {
  source = "../variables"
}

data "aws_secretsmanager_secret" "langevals" {
  name = "langevals_secrets"
}

data "aws_secretsmanager_secret_version" "langevals" {
  secret_id = data.aws_secretsmanager_secret.langevals.id
}

locals {
  evaluator_package = var.evaluator_package
  tag               = data.external.docker_tag.result["tag"]
  git_tag           = data.external.docker_tag.result["git_tag"]
}

data "external" "docker_tag" {
  program = ["${path.root}/scripts/get_langevals_git_sha.sh", local.evaluator_package]
}

resource "aws_lambda_function" "this" {
  count         = module.variables.profile == "lw-prod" ? 1 : 0
  package_type  = "Image"
  function_name = "${local.evaluator_package}-evaluator-lambda"
  image_uri     = "${data.aws_ecr_repository.lambda_repository.repository_url}:${local.tag}"
  role          = aws_iam_role.lambda.arn
  timeout       = 60

  # use `/usr/bin/time -alh poetry run python langevals/server.py --only <evaluator>` to get the memory usage (maximum resident set size in bytes)
  memory_size = local.evaluator_package == "lingua" ? 1896 : local.evaluator_package == "ragas" ? 512 : local.evaluator_package == "langevals" ? 512 : 256

  environment {
    variables = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda,
    null_resource.docker_image,
    aws_cloudwatch_log_group.this
  ]
}

resource "aws_cloudwatch_metric_alarm" "lambda_function_errors" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "${local.evaluator_package}-lambda-errors"
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  evaluation_periods        = "1"
  metric_name               = "Errors"
  namespace                 = "AWS/Lambda"
  period                    = "60"
  statistic                 = "Sum"
  threshold                 = "1"
  alarm_description         = "Alarm when ${local.evaluator_package} lambda has errors"
  actions_enabled           = true
  alarm_actions             = [var.sns_alarms_topic_arn]
  ok_actions                = [var.sns_alarms_topic_arn]
  insufficient_data_actions = [var.sns_alarms_topic_arn]

  dimensions = {
    FunctionName = aws_lambda_function.this[0].function_name
  }

  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.evaluator_package}-evaluator-lambda"
  retention_in_days = 365
}

data "aws_ecr_repository" "lambda_repository" {
  name = aws_ecr_repository.lambda_repository.name
}

resource "aws_ecr_lifecycle_policy" "lambda_repository" {
  repository = aws_ecr_repository.lambda_repository.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain only 3 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 3
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "null_resource" "docker_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  triggers = {
    image_hash = local.tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building ${local.evaluator_package}..."
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      last_tag=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} describe-images --repository-name ${data.aws_ecr_repository.lambda_repository.name} \
        --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]' --output yaml \
        | tail -n 1 | awk -F'- ' '{print $2}')
      set -e
      cache_from=""
      if [ -n "$last_tag" ]; then
        cache_from="--cache-from type=registry,ref=${data.aws_ecr_repository.lambda_repository.name}:$last_tag"
      fi

      cd ${path.root}/../langevals
      set +e
      image_exists=$(docker manifest inspect ${data.aws_ecr_repository.lambda_repository.repository_url}:${local.tag} > /dev/null 2>&1 && echo yes)
      set -e
      if [ -z "$image_exists" ]; then
        docker buildx build . -f Dockerfile.lambda --build-arg EVALUATOR=${local.evaluator_package} --platform="linux/amd64" --provenance=false $cache_from --cache-to type=inline --push -t ${data.aws_ecr_repository.lambda_repository.repository_url}:${local.tag}
        set +e
        MANIFEST=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} batch-get-image --repository-name ${data.aws_ecr_repository.lambda_repository.name} --image-ids imageTag=${local.tag} --query 'images[].imageManifest' --output text)
        aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} put-image --repository-name ${data.aws_ecr_repository.lambda_repository.name} --image-tag ${local.git_tag} --image-manifest "$MANIFEST"
        set -e
      fi
      cd -
    EOT

    interpreter = ["/bin/bash", "-c"]
    on_failure  = fail
  }

  depends_on = [aws_ecr_repository.lambda_repository]
}

resource "aws_ecr_repository" "lambda_repository" {
  name                 = "${local.evaluator_package}-lambda"
  image_tag_mutability = "IMMUTABLE"
}

# IAM role which dictates what other AWS services the Lambda function
# may access.
resource "aws_iam_role" "lambda" {
  name = "${local.evaluator_package}-lambda-role"

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
  name        = "${local.evaluator_package}-lambda-policy"
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
  count = module.variables.profile == "lw-prod" ? 1 : 0

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[0].function_name
  principal     = "apigateway.amazonaws.com"

  # The /*/* portion grants access from any method on any resource
  # within the API Gateway "REST API".
  source_arn = "${var.apigw_execution_arn}/*/*"
}

# Keep lambda warm

resource "aws_cloudwatch_event_rule" "keep_warm" {
  count               = module.variables.profile == "lw-prod" ? 1 : 0
  name                = "${local.evaluator_package}-lambda-keep-warm"
  description         = "Keep ${local.evaluator_package} Lambda function warm"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "keep_warm" {
  count     = module.variables.profile == "lw-prod" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.keep_warm[0].name
  target_id = "KeepWarmLambda"
  arn       = aws_lambda_function.this[0].arn
  input = jsonencode({
    "version" : "2.0",
    "routeKey" : "GET /healthcheck",
    "rawPath" : "/healthcheck",
    "rawQueryString" : "",
    "headers" : {
      "content-type" : "application/json"
    },
    "requestContext" : {
      "accountId" : "123456789012",
      "apiId" : "api-id",
      "domainName" : "id.execute-api.us-east-1.amazonaws.com",
      "domainPrefix" : "id",
      "http" : {
        "method" : "GET",
        "path" : "/healthcheck",
        "protocol" : "HTTP/1.1",
        "sourceIp" : "192.168.0.1",
        "userAgent" : "agent"
      },
      "requestId" : "id",
      "routeKey" : "GET /healthcheck",
      "stage" : "$default",
      "time" : "12/Mar/2020:19:03:58 +0000",
      "timeEpoch" : 1583348638390
    },
    "isBase64Encoded" : false
  })
}

resource "aws_lambda_permission" "allow_cloudwatch" {
  count         = module.variables.profile == "lw-prod" ? 1 : 0
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.keep_warm[0].arn
}
