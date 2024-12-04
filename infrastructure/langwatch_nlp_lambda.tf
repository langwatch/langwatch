locals {
  langwatch_nlp_tag     = data.external.langwatch_nlp_docker_tag.result["tag"]
  langwatch_nlp_git_tag = data.external.langwatch_nlp_docker_tag.result["git_tag"]
}

data "external" "langwatch_nlp_docker_tag" {
  program = ["${path.root}/scripts/get_langwatch_nlp_git_sha.sh"]
}

# Build and push Docker image for Lambda
resource "null_resource" "langwatch_nlp_docker_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  triggers = {
    image_hash = local.langwatch_nlp_tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building LangWatch NLP Lambda..."
      cd ../langwatch/langwatch_nlp
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      last_tag=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} describe-images --repository-name ${aws_ecr_repository.langwatch_nlp.name} \
        --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]' --output yaml \
        | tail -n 1 | awk -F'- ' '{print $2}')
      set -e
      cache_from=""
      if [ -n "$last_tag" ]; then
        cache_from="--cache-from type=registry,ref=${aws_ecr_repository.langwatch_nlp.repository_url}:$last_tag"
      fi

      set +e
      image_exists=$(docker manifest inspect ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag} > /dev/null 2>&1 && echo yes)
      set -e
      if [ -z "$image_exists" ]; then
        docker buildx build . -f Dockerfile.lambda --platform="linux/arm64" $cache_from --cache-to type=inline --push -t ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}
        set +e
        MANIFEST=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} batch-get-image --repository-name ${aws_ecr_repository.langwatch_nlp.name} --image-ids imageTag=${local.langwatch_nlp_tag} --query 'images[].imageManifest' --output text)
        # aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} put-image --repository-name ${aws_ecr_repository.langwatch_nlp.name} --image-tag ${local.langwatch_nlp_git_tag} --image-manifest "$MANIFEST"
        set -e
      fi
      cd -
    EOT

    interpreter = ["/bin/bash", "-c"]
    on_failure  = fail
  }

  depends_on = [aws_ecr_repository.langwatch_nlp]
}

# IAM role for the Lambda function
resource "aws_iam_role" "langwatch_nlp" {
  name = "langwatch-nlp-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# Basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "langwatch_nlp_basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.langwatch_nlp.name
}

# S3 Bucket for NLP Lambda cache
resource "aws_s3_bucket" "langwatch_nlp_cache" {
  bucket = "langwatch-nlp-cache-${data.aws_caller_identity.current.account_id}"
}

# Add CloudWatch metric and alarm for bucket size
resource "aws_cloudwatch_metric_alarm" "bucket_size_alarm" {
  alarm_name          = "langwatch-nlp-cache-size-alarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "BucketSizeBytes"
  namespace           = "AWS/S3"
  period              = "86400" # 24 hours
  statistic           = "Average"
  threshold           = 1073741824 # 1GB - alert before hitting limit
  alarm_description   = "This metric monitors S3 bucket size"
  alarm_actions       = [] # Add SNS topic ARN here if you want notifications

  dimensions = {
    BucketName  = aws_s3_bucket.langwatch_nlp_cache.id
    StorageType = "StandardStorage"
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "langwatch_nlp_cache" {
  bucket = aws_s3_bucket.langwatch_nlp_cache.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Lifecycle rule to delete objects after 24 hours
resource "aws_s3_bucket_lifecycle_configuration" "langwatch_nlp_cache" {
  bucket = aws_s3_bucket.langwatch_nlp_cache.id

  rule {
    id     = "delete-after-24h"
    status = "Enabled"

    expiration {
      days = 1
    }
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "langwatch_nlp_cache" {
  bucket = aws_s3_bucket.langwatch_nlp_cache.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM policy for Lambda to access S3 bucket
resource "aws_iam_policy" "langwatch_nlp_s3_access" {
  name = "langwatch-nlp-s3-access"
  path = "/"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:HeadObject"
        ]
        Resource = [
          "${aws_s3_bucket.langwatch_nlp_cache.arn}/cache/*",
          "${aws_s3_bucket.langwatch_nlp_cache.arn}/kill/*"
        ]
      },
    ]
  })
}

# Attach S3 access policy to Lambda role
resource "aws_iam_role_policy_attachment" "langwatch_nlp_s3_access" {
  policy_arn = aws_iam_policy.langwatch_nlp_s3_access.arn
  role       = aws_iam_role.langwatch_nlp.name
}

# Lambda function
resource "aws_lambda_function" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  function_name = "langwatch-nlp"
  role          = aws_iam_role.langwatch_nlp.arn
  timeout       = 900 # 15 minutes
  memory_size   = 1024

  package_type = "Image"
  image_uri    = "${aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}"

  architectures = ["arm64"]

  environment {
    variables = {
      LANGWATCH_ENDPOINT  = "https://app.langwatch.ai"
      STUDIO_RUNTIME      = "async"
      AWS_LWA_INVOKE_MODE = "RESPONSE_STREAM"
      CACHE_BUCKET        = aws_s3_bucket.langwatch_nlp_cache.id
    }
  }

  # Explicitly state we don't want VPC access
  vpc_config {
    # Empty subnet_ids and security_group_ids means the Lambda runs outside VPC
    subnet_ids         = []
    security_group_ids = []
  }

  depends_on = [null_resource.langwatch_nlp_docker_image]
}

# CloudWatch Log Group for Lambda
resource "aws_cloudwatch_log_group" "langwatch_nlp" {
  count             = module.variables.profile == "lw-prod" ? 1 : 0
  name              = "/aws/lambda/langwatch-nlp"
  retention_in_days = 14
}

# ECR Repository for Lambda
resource "aws_ecr_repository" "langwatch_nlp" {
  name                 = "langwatch_nlp"
  image_tag_mutability = "IMMUTABLE"
}

data "aws_ecr_repository" "langwatch_nlp" {
  name = aws_ecr_repository.langwatch_nlp.name
}

# ECR Lifecycle policy
resource "aws_ecr_lifecycle_policy" "langwatch_nlp" {
  repository = aws_ecr_repository.langwatch_nlp.name

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

# Lambda Function URL with IAM auth
resource "aws_lambda_function_url" "langwatch_nlp" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  function_name      = aws_lambda_function.langwatch_nlp[0].function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"

  cors {
    allow_credentials = true
    allow_origins     = ["*"]
    allow_methods     = ["*"]
    max_age           = 86400
  }
}

# CloudWatch Event Rule for Lambda warming
resource "aws_cloudwatch_event_rule" "lambda_warmer" {
  count               = module.variables.profile == "lw-prod" ? 1 : 0
  name                = "langwatch-nlp-warmer"
  description         = "Keep Lambda warm by invoking it periodically"
  schedule_expression = "rate(5 minutes)"
}

# Warmer Lambda function
resource "aws_lambda_function" "langwatch_nlp_warmer" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  filename         = "${path.module}/lambda/warmer.zip"
  source_code_hash = data.archive_file.warmer_lambda.output_base64sha256
  function_name    = "langwatch-nlp-warmer"
  role             = aws_iam_role.langwatch_nlp_warmer.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      TARGET_URL  = trimsuffix(aws_lambda_function_url.langwatch_nlp[0].function_url, "/")
      CONCURRENCY = "20"
    }
  }
}

# Warmer Lambda IAM role
resource "aws_iam_role" "langwatch_nlp_warmer" {
  name = "langwatch-nlp-warmer-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# Basic execution policy for warmer Lambda
resource "aws_iam_role_policy_attachment" "langwatch_nlp_warmer_basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.langwatch_nlp_warmer.name
}

# Single target for the warmer Lambda
resource "aws_cloudwatch_event_target" "lambda_warmer" {
  count     = module.variables.profile == "lw-prod" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.lambda_warmer[0].name
  arn       = aws_lambda_function.langwatch_nlp_warmer[0].arn
  target_id = "WarmLangwatchNLP"
}

# CloudWatch Log Group for warmer Lambda
resource "aws_cloudwatch_log_group" "langwatch_nlp_warmer" {
  count             = module.variables.profile == "lw-prod" ? 1 : 0
  name              = "/aws/lambda/langwatch-nlp-warmer"
  retention_in_days = 1
}

# Update the warmer Lambda code with logging
data "archive_file" "warmer_lambda" {
  type        = "zip"
  output_path = "${path.module}/lambda/warmer.zip"

  source {
    content  = <<EOF
exports.handler = async (event) => {
    const targetUrl = process.env.TARGET_URL;
    const concurrency = parseInt(process.env.CONCURRENCY || '20');
    console.log(`[$${new Date().toISOString()}] Starting warm-up: $${concurrency} concurrent requests to $${targetUrl}`);

    const makeRequest = async (i) => {
        console.log(`[$${new Date().toISOString()}] Making request $${i + 1}/$${concurrency}`);
        const start = Date.now();

        try {
            await fetch(`$${targetUrl}/health`);
            const duration = Date.now() - start;
            console.log(`[$${new Date().toISOString()}] Request $${i + 1} completed successfully in $${duration}ms`);
        } catch (err) {
            const duration = Date.now() - start;
            console.error(`[$${new Date().toISOString()}] Request $${i + 1} failed in $${duration}ms:`, err.message);
        }
    };

    try {
        const requests = Array(concurrency).fill().map((_, i) => makeRequest(i));
        await Promise.all(requests);
        console.log(`[$${new Date().toISOString()}] All warm-up requests completed successfully`);
        return { statusCode: 200, body: 'Warming completed' };
    } catch (error) {
        console.error(`[$${new Date().toISOString()}] Warm-up failed:`, error);
        throw error;
    }
};
EOF
    filename = "index.js"
  }
}

# Permission for CloudWatch Events to invoke the warmer Lambda
resource "aws_lambda_permission" "allow_eventbridge_warmer" {
  count         = module.variables.profile == "lw-prod" ? 1 : 0
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.langwatch_nlp_warmer[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.lambda_warmer[0].arn
}
