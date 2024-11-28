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

resource "aws_guardduty_detector" "this" {
  enable = true
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
