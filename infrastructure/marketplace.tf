# Certificate for installation subdomains

resource "aws_acm_certificate" "wildcard_cert" {
  domain_name       = "*.aws.langwatch.ai"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "LangWatch Wildcard Certificate"
  }
}

output "certificate_arn" {
  value       = aws_acm_certificate.wildcard_cert.arn
  description = "ARN of the wildcard certificate"
}

resource "aws_ram_resource_share" "cert_share" {
  name                      = "langwatch-wildcard-cert-share"
  allow_external_principals = true
}

resource "aws_ram_resource_association" "cert_association" {
  resource_arn       = aws_acm_certificate.wildcard_cert.arn
  resource_share_arn = aws_ram_resource_share.cert_share.arn
}

resource "aws_acm_certificate_policy" "wildcard_cert_policy" {
  certificate_arn = aws_acm_certificate.wildcard_cert.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowAllAccountsToUse"
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action = [
          "acm:DescribeCertificate",
          "acm:ListTagsForCertificate",
          "acm:GetCertificate"
        ]
        Resource = aws_acm_certificate.wildcard_cert.arn
      }
    ]
  })
}


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
