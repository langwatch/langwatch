terraform {
  required_version = ">= 1.7"
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.0"
    }
  }
}

variable "namespace" {
  default = "clickhouse"
}

variable "cpu" {
  default = 4
}

variable "memory" {
  default = "16Gi"
}

variable "replicas" {
  default = 1
}

variable "storage_size" {
  default = "100Gi"
}

variable "chart_version" {
  default = "0.1.0"
}

resource "helm_release" "clickhouse" {
  name             = "clickhouse"
  repository       = "https://langwatch.github.io/langwatch"
  chart            = "clickhouse-serverless"
  version          = var.chart_version
  namespace        = var.namespace
  create_namespace = true

  set {
    name  = "cpu"
    value = var.cpu
  }

  set {
    name  = "memory"
    value = var.memory
  }

  set {
    name  = "replicas"
    value = var.replicas
  }

  set {
    name  = "storage.size"
    value = var.storage_size
  }
}

output "service_name" {
  value = "${helm_release.clickhouse.name}-clickhouse"
}

output "namespace" {
  value = helm_release.clickhouse.namespace
}
