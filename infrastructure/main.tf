module "variables" {
  source = "./variables"
}

provider "aws" {
  region  = module.variables.region
  profile = module.variables.profile
}

provider "awscc" {
  region  = module.variables.region
  profile = module.variables.profile
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "langevals-api"
  description = "LangEvals API"
}

resource "aws_guardduty_detector" "this" {
  enable = true
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "awscc_chatbot_slack_channel_configuration" "langwatch" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  configuration_name = "langwatch-chatbot"
  iam_role_arn       = awscc_iam_role.langwatch.arn
  slack_workspace_id = "T067B8XMC0M" # langwatch
  slack_channel_id   = "C06JQLW1HE2" # #dev

  sns_topic_arns = [
    aws_sns_topic.alarms.arn
  ]
}
