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

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}