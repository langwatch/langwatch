resource "awscc_chatbot_slack_channel_configuration" "chatbot" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  configuration_name = "langwatch-chatbot"
  iam_role_arn       = awscc_iam_role.chatbot.arn
  slack_workspace_id = "T067B8XMC0M" # langwatch
  slack_channel_id   = "C06JQLW1HE2" # #dev

  tags = [{
    key = "Name"
    value = "langwatch-chatbot"
  }]

  sns_topic_arns = [
    aws_sns_topic.alarms.arn,
    aws_sns_topic.langwatch-deploy-notifications[0].arn
  ]
  logging_level = "INFO"
}

resource "aws_sns_topic" "alarms" {
  name              = "cw-alarms-topic"
  kms_master_key_id = aws_kms_key.alarms_sns_topic_key.arn

  tags = {
    Name = "cw-alarms-topic"
  }
}

resource "aws_kms_key" "alarms_sns_topic_key" {
  description = "KMS key for SNS topic encryption"
  policy = jsonencode({
    Version : "2012-10-17",
    Id : "key-default-1",
    Statement : [
      {
        Sid : "Enable IAM User Permissions",
        Effect : "Allow",
        Principal : {
          AWS : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        },
        Action : "kms:*",
        Resource : "*"
      },
      {
        Sid : "Allow use of the key for CloudWatch",
        Effect : "Allow",
        Principal : {
          Service : "cloudwatch.amazonaws.com"
        },
        Action : [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ],
        Resource : "*"
      },
      {
        Sid : "Allow access through SNS for all principals in the account that are authorized to use SNS",
        Effect : "Allow",
        Principal : {
          AWS : "*"
        },
        Action : [
          "kms:Decrypt",
          "kms:GenerateDataKey*",
          "kms:CreateGrant",
          "kms:ListGrants",
          "kms:DescribeKey"
        ],
        Resource : "*",
        Condition : {
          StringEquals : {
            "kms:ViaService" : "sns.eu-central-1.amazonaws.com",
            "kms:CallerAccount" : data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_sns_topic" "langwatch-deploy-notifications" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "langwatch-deploy-notifications"
}

resource "awscc_iam_role" "chatbot" {
  role_name = "chatbot_role"
  assume_role_policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = ""
        Principal = {
          Service = "chatbot.amazonaws.com"
        }
      },
    ]
  })
  managed_policy_arns = ["arn:aws:iam::aws:policy/AWSResourceExplorerReadOnlyAccess"]
}

resource "aws_sns_topic_policy" "alarms_policy" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  arn = aws_sns_topic.alarms.arn
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "AllowChatbotInteractions"
        Effect = "Allow",
        Principal = {
          AWS = awscc_iam_role.chatbot.arn
        },
        Action = [
          "sns:Subscribe",
          "sns:Receive"
        ],
        Resource = aws_sns_topic.alarms.arn
      },
      {
        Sid = "AllowCloudWatchEventsPublish"
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "events.amazonaws.com"
        },
        "Action" : ["sns:Publish"],
        "Resource" : aws_sns_topic.alarms.arn
      },
      {
        Sid = "AllowCloudWatchPublish"
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "cloudwatch.amazonaws.com"
        },
        "Action" : ["sns:Publish"],
        "Resource" : aws_sns_topic.alarms.arn
      }
    ]
  })
}

resource "aws_sns_topic_policy" "deploy_notifications_policy" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  arn   = aws_sns_topic.langwatch-deploy-notifications[0].arn
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "AllowChatbotInteractions"
        Effect = "Allow",
        Principal = {
          AWS = awscc_iam_role.chatbot.arn
        },
        Action = [
          "sns:Subscribe",
          "sns:Receive"
        ],
        Resource = aws_sns_topic.langwatch-deploy-notifications[0].arn
      },
      {
        Sid = "AllowCodeDeployPublish"
        "Effect" : "Allow",
        "Principal" : {
          "Service" : "codestar-notifications.amazonaws.com"
        },
        "Action" : ["sns:Publish"],
        "Resource" : aws_sns_topic.langwatch-deploy-notifications[0].arn
      }
    ]
  })
}
