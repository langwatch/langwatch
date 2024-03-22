module "variables" {
  source = "../variables"
}

locals {
  evaluator_package     = var.evaluator_package
  environment_variables = var.environment_variables
  tag                   = data.external.git_tag.result["tag"]
}

data "external" "git_tag" {
  program = ["${path.root}/scripts/get_langevals_git_sha.sh"]
}

resource "aws_lambda_function" "this" {
  count         = module.variables.profile == "lw-prod" ? 1 : 0
  package_type  = "Image"
  function_name = "${local.evaluator_package}-evaluator-lambda"
  image_uri     = "${data.aws_ecr_repository.lambda_repository.repository_url}:${local.tag}"
  role          = aws_iam_role.lambda.arn
  timeout       = 60

  # use `/usr/bin/time -alh poetry run python langevals/server.py --only <evaluator>` to get the memory usage (maximum resident set size in bytes)
  memory_size = local.evaluator_package == "lingua" ? 1896 : local.evaluator_package == "ragas" ? 512 : 256

  environment {
    variables = local.environment_variables
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda,
    null_resource.docker_image,
    aws_cloudwatch_log_group.this
  ]
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.evaluator_package}-evaluator-lambda"
  retention_in_days = 30
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
        cache_from="--cache-from ${data.aws_ecr_repository.lambda_repository.name}:$last_tag"
      fi

      cd ${path.root}/../langevals
      docker build . --build-arg EVALUATOR=${local.evaluator_package} --platform="linux/amd64" $cache_from -t ${data.aws_ecr_repository.lambda_repository.repository_url}:${local.tag}
      docker push ${data.aws_ecr_repository.lambda_repository.repository_url}:${local.tag}
      cd -
    EOT

    on_failure = fail
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
