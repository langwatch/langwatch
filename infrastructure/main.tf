module "variables" {
  source = "./variables"
}

provider "aws" {
  region  = "eu-central-1"
  profile = module.variables.profile
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "langevals-api"
  description = "LangEvals API"
}

data "aws_secretsmanager_secret" "langevals" {
  name = "langevals_secrets"
}

data "aws_secretsmanager_secret_version" "langevals" {
  secret_id = data.aws_secretsmanager_secret.langevals.id
}

data "aws_secretsmanager_secret" "langwatch" {
  name = "langwatch_secrets"
}

data "aws_secretsmanager_secret_version" "langwatch" {
  secret_id = data.aws_secretsmanager_secret.langwatch.id
}
