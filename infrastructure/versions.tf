terraform {
  required_version = ">=1.7.4"

  backend "s3" {
    bucket = "langwatch-terraform"
    key    = "langwatch-state"

    profile = "lw-root-tf"
    region  = "eu-central-1"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
