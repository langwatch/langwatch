# Example: ClickHouse with S3 cold storage and IRSA
#
# Usage:
#   terraform apply -var="s3_bucket=my-clickhouse-cold" -var="s3_region=us-east-1"

variable "s3_bucket" {
  description = "S3 bucket for cold storage"
  default     = ""
}

variable "s3_region" {
  description = "S3 region"
  default     = "us-east-1"
}

resource "helm_release" "clickhouse_with_cold" {
  count = var.s3_bucket != "" ? 1 : 0

  name             = "clickhouse"
  repository       = "https://langwatch.github.io/langwatch"
  chart            = "clickhouse-serverless"
  version          = var.chart_version
  namespace        = var.namespace
  create_namespace = true

  set {
    name  = "cpu"
    value = "8"
  }

  set {
    name  = "memory"
    value = "32Gi"
  }

  set {
    name  = "cold.enabled"
    value = "true"
  }

  set {
    name  = "backup.enabled"
    value = "true"
  }

  set {
    name  = "objectStorage.bucket"
    value = var.s3_bucket
  }

  set {
    name  = "objectStorage.region"
    value = var.s3_region
  }

  set {
    name  = "objectStorage.useEnvironmentCredentials"
    value = "true"
  }
}
