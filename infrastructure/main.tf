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

  endpoint_configuration {
    types            = ["PRIVATE"]
    vpc_endpoint_ids = [module.endpoints[0].endpoints["execute_api"].id]
  }
}

resource "aws_guardduty_detector" "this" {
  enable = true
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
