provider "aws" {
  region  = "eu-central-1"
  profile = "lw-prod"
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "langevals-api"
  description = "LangEvals API"
}