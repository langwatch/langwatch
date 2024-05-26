resource "aws_s3_bucket" "rds_backups" {
  bucket = "langwatch-rds-manual-backups-${data.aws_caller_identity.current.account_id}"
}

// s3 lifecycle policy: 1 day retention only
resource "aws_s3_bucket_lifecycle_configuration" "rds_backups" {
  bucket = aws_s3_bucket.rds_backups.bucket

  rule {
    id = "rds-backups"

    filter {}

    status = "Enabled"

    expiration {
      days = 1
    }
  }
}

// create kms key for sns topic
resource "aws_kms_key" "sns_events_key" {
  description             = "KMS key for langwatch events"
  deletion_window_in_days = 10
  policy = jsonencode({
    Version : "2012-10-17",
    Statement : [
      {
        Effect : "Allow",
        Principal : {
          Service : "events.rds.amazonaws.com"
        },
        Action : "kms:*",
        Resource : "*"
      },
      {
        Effect : "Allow",
        Principal : {
          Service : "s3.amazonaws.com"
        },
        Action : "kms:*",
        Resource : "*"
      },
      {
        Effect : "Allow",
        Principal : {
          Service : "sns.amazonaws.com"
        },
        Action : "kms:*",
        Resource : "*"
      },
      {
        Effect : "Allow",
        Principal : {
          AWS : "*"
        },
        Action : "kms:*",
        Resource : "*"
      }
    ]
  })
}

resource "aws_sns_topic" "events" {
  name              = "langwatch-events-topic"
  kms_master_key_id = aws_kms_key.sns_events_key.id

  tags = {
    Name = "lw-events-topic"
  }
}

# dead letter queue for events topic
resource "aws_sqs_queue" "events_dlq" {
  name = "langwatch-events-dlq"
}

resource "aws_iam_role" "lambda_rds_backup_role" {
  name = "lambda_rds_backup_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Effect" : "Allow",
        "Action" : "sts:AssumeRole",
        "Principal" : {
          "Service" : "lambda.amazonaws.com"
        },
        "Sid" : ""
      },
      {
        "Effect" : "Allow",
        "Action" : "sts:AssumeRole",
        "Principal" : {
          "Service" : "export.rds.amazonaws.com"
        },
        "Sid" : ""
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_rds_backup_policy" {
  name = "lambda_rds_backup_policy"
  role = aws_iam_role.lambda_rds_backup_role.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Effect" : "Allow",
        "Action" : [
          "rds:CreateDBSnapshot",
          "rds:DescribeDBSnapshots",
          "rds:StartExportTask",
          "s3:Put*",
          "s3:Abort*",
          "s3:List*",
          "s3:Get*",
          "s3:Delete*",
          "iam:PassRole"
        ],
        "Resource" : "*"
      },
      {
        "Effect" : "Allow",
        "Action" : "logs:*",
        "Resource" : "*"
      }
    ]
  })
}

# Create snapshot lambda function
data "archive_file" "create_snapshot" {
  type        = "zip"
  output_path = "${path.module}/functions/create_snapshot.zip"
  source_dir  = "${path.module}/functions/create_snapshot"
}

resource "aws_lambda_function" "create_rds_backup" {
  filename         = data.archive_file.create_snapshot.output_path
  function_name    = "create-rds-snapshot"
  role             = aws_iam_role.lambda_rds_backup_role.arn
  handler          = "create_rds_snapshot.lambda_handler"
  runtime          = "python3.11"
  source_code_hash = filebase64sha256(data.archive_file.create_snapshot.output_path)

  environment {
    variables = {
      DB_INSTANCE_IDENTIFIER = aws_db_instance.langwatch.identifier
    }
  }
}

# Export snapshot to s3 function
data "archive_file" "export_snapshot" {
  type        = "zip"
  output_path = "${path.module}/functions/store_snapshot_s3.zip"
  source_dir  = "${path.module}/functions/store_snapshot_s3"
}

resource "aws_lambda_function" "export_rds_backup" {
  filename         = data.archive_file.export_snapshot.output_path
  function_name    = "export-snapshot-to-s3"
  role             = aws_iam_role.lambda_rds_backup_role.arn
  handler          = "export_to_s3.lambda_handler"
  runtime          = "python3.11"
  source_code_hash = filebase64sha256(data.archive_file.export_snapshot.output_path)

  environment {
    variables = {
      BUCKET_NAME  = aws_s3_bucket.rds_backups.bucket
      IAM_ROLE_ARN = aws_iam_role.lambda_rds_backup_role.arn
      KMS_KEY_ID   = aws_kms_key.sns_events_key.id
    }
  }
}

// Create RDS event subscription for manual snapshots
resource "aws_db_event_subscription" "rds_snapshot_event" {
  name        = "rds-manual-snapshot-event"
  source_type = "db-snapshot"
  sns_topic   = aws_sns_topic.events.arn
}

// Allow trigger lambda function after sns topic receives an event
resource "aws_lambda_permission" "sns_to_lambda_rds_backup" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.export_rds_backup.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.events.arn
}

// Call lambda from sns topic
resource "aws_sns_topic_subscription" "sns_to_lambda_rds_backup" {
  topic_arn = aws_sns_topic.events.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.export_rds_backup.arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.events_dlq.arn
  })
}

# Allow sns to send dlq messages
resource "aws_sqs_queue_policy" "events_dlq_policy" {
  queue_url = aws_sqs_queue.events_dlq.url

  policy = jsonencode({
    Version : "2012-10-17",
    Statement : [
      {
        Effect : "Allow",
        Principal : {
          "Service" : "sns.amazonaws.com"
        },
        Action : "sqs:SendMessage",
        Resource : aws_sqs_queue.events_dlq.arn,
        Condition : {
          ArnEquals : {
            "aws:SourceArn" : aws_sns_topic.events.arn
          }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_event_rule" "every_hour" {
  name                = "every_hour"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "rds_backup_target" {
  rule = aws_cloudwatch_event_rule.every_hour.name
  arn  = aws_lambda_function.create_rds_backup.arn
}

resource "aws_lambda_permission" "allow_cloudwatch_to_call_lambda" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_rds_backup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.every_hour.arn
}
