# Repositories for onprem to store the docker images

resource "aws_ecr_repository" "onprem_langwatch_saas" {
  name                 = "onprem_langwatch_saas"
  image_tag_mutability = "MUTABLE"
}

data "aws_ecr_repository" "onprem_langwatch_saas" {
  name = aws_ecr_repository.onprem_langwatch_saas.name
}

resource "aws_ecr_repository" "onprem_langwatch_nlp" {
  name                 = "onprem_langwatch_nlp"
  image_tag_mutability = "MUTABLE"
}

data "aws_ecr_repository" "onprem_langwatch_nlp" {
  name = aws_ecr_repository.onprem_langwatch_nlp.name
}

resource "aws_ecr_repository" "openprem_langevals" {
  name                 = "openprem_langevals"
  image_tag_mutability = "MUTABLE"
}

data "aws_ecr_repository" "openprem_langevals" {
  name = aws_ecr_repository.openprem_langevals.name
}

resource "aws_ecr_repository_policy" "onprem_langwatch_saas_marketplace_access" {
  repository = aws_ecr_repository.onprem_langwatch_saas.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowMarketplaceAccess"
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
        Condition = {
          StringLike = {
            "aws:PrincipalARN" : [
              "arn:aws:iam::*:role/AWS-Marketplace-*",
              "arn:aws:iam::*:role/aws-service-role/servicecatalog.amazonaws.com/AWSServiceRoleForMarketplaceCatalogManagement",
              "arn:aws:iam::339713169384:role/*" # sf-dev account
            ]
          }
        }
      }
    ]
  })
}

resource "aws_ecr_repository_policy" "onprem_langwatch_nlp_marketplace_access" {
  repository = aws_ecr_repository.onprem_langwatch_nlp.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowMarketplaceAccess"
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
        Condition = {
          StringLike = {
            "aws:PrincipalARN" : [
              "arn:aws:iam::*:role/AWS-Marketplace-*",
              "arn:aws:iam::*:role/aws-service-role/servicecatalog.amazonaws.com/AWSServiceRoleForMarketplaceCatalogManagement",
              "arn:aws:iam::339713169384:role/*" # sf-dev account
            ]
          }
        }
      }
    ]
  })
}

resource "aws_ecr_repository_policy" "onprem_langevals_marketplace_access" {
  repository = aws_ecr_repository.openprem_langevals.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowMarketplaceAccess"
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
        Condition = {
          StringLike = {
            "aws:PrincipalARN" : [
              "arn:aws:iam::*:role/AWS-Marketplace-*",
              "arn:aws:iam::*:role/aws-service-role/servicecatalog.amazonaws.com/AWSServiceRoleForMarketplaceCatalogManagement",
              "arn:aws:iam::339713169384:role/*" # sf-dev account
            ]
          }
        }
      }
    ]
  })
}
