resource "awscc_chatbot_slack_channel_configuration" "langwatch" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  configuration_name = "langwatch-chatbot"
  iam_role_arn       = awscc_iam_role.langwatch.arn
  slack_workspace_id = "T067B8XMC0M" # langwatch
  slack_channel_id   = "C06JQLW1HE2" # #dev
}

resource "aws_cloudwatch_event_rule" "sns_to_slack" {
  name        = "sns-to-slack"
  description = "Route SNS notifications to Slack via AWS Chatbot"

  event_pattern = jsonencode({
    "source" : [
      "aws.sns"
    ],
    "resources" : [
      aws_sns_topic.alarms.arn,
      aws_sns_topic.langwatch-deploy-notifications.arn
    ]
  })
}

resource "aws_cloudwatch_event_target" "chatbot_slack_target" {
  rule      = aws_cloudwatch_event_rule.sns_to_slack.name
  target_id = "sendToSlack"
  arn       = awscc_chatbot_slack_channel_configuration.langwatch[0].arn

  input_transformer {
    input_paths = {
      sns-message = "$.detail"
    }
    input_template = "\"<sns-message>\""
  }
}
