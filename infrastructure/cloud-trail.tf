locals {
  cloudtrail_name              = "account-activity-logs"
  cloudtrail_bucket_key_prefix = "cloudtrail-logs"
}

resource "aws_s3_bucket" "cloudtrail-logs" {
  count  = module.variables.profile == "lw-prod" ? 1 : 0
  bucket = "langwatch-prod-cloudtrail-logs"

  force_destroy = true
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudtrail-logs" {
  count  = module.variables.profile == "lw-prod" ? 1 : 0
  bucket = aws_s3_bucket.cloudtrail-logs[0].id

  rule {
    id = "log"

    filter {}

    status = "Enabled"

    expiration {
      days = 5 * 365
    }

    transition {
      days          = 365
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 2 * 365
      storage_class = "GLACIER"
    }
  }
}

resource "aws_cloudtrail" "logs" {
  count                         = module.variables.profile == "lw-prod" ? 1 : 0
  name                          = local.cloudtrail_name
  s3_bucket_name                = aws_s3_bucket.cloudtrail-logs[0].bucket
  s3_key_prefix                 = local.cloudtrail_bucket_key_prefix
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    # Log all s3 and lambda events
    data_resource {
      type   = "AWS::S3::Object"
      values = ["arn:aws:s3"]
    }

    data_resource {
      type   = "AWS::Lambda::Function"
      values = ["arn:aws:lambda"]
    }
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail[0]]
}

resource "aws_s3_bucket_policy" "cloudtrail" {
  count  = module.variables.profile == "lw-prod" ? 1 : 0
  bucket = aws_s3_bucket.cloudtrail-logs[0].bucket
  policy = data.aws_iam_policy_document.cloudtrail[0].json
}

data "aws_iam_policy_document" "cloudtrail" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  statement {
    sid    = "AWSCloudTrailAclCheck"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.cloudtrail-logs[0].arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:trail/${local.cloudtrail_name}"]
    }
  }

  statement {
    sid    = "AWSCloudTrailWrite"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.cloudtrail-logs[0].arn}",
      "${aws_s3_bucket.cloudtrail-logs[0].arn}/*"
    ]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:trail/${local.cloudtrail_name}"]
    }
  }
}
