# Generate required secrets
resource "random_password" "nextauth_secret" {
  length  = 32
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 32
  special = false
}

resource "random_password" "metrics_api_key" {
  length  = 32
  special = false
}

# Main LangWatch Deployment
resource "kubernetes_deployment" "langwatch" {
  metadata {
    name = "langwatch"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "langwatch"
      }
    }

    template {
      metadata {
        labels = {
          app = "langwatch"
        }
      }

      spec {
        container {
          name  = "langwatch"
          image = "europe-west3-docker.pkg.dev/langwatch/onprem/langwatch_saas:${local.langwatch_version}"
          image_pull_policy = "Always"

          port {
            container_port = 3000
          }

          env {
            name  = "BASE_HOST"
            value = "https://${var.domain}"
          }

          env {
            name  = "NEXTAUTH_URL"
            value = "https://${var.domain}"
          }

          env {
            name  = "DEBUG"
            value = "langwatch:*"
          }

          env {
            name  = "NEXTAUTH_PROVIDER"
            value = "email"
          }

          env {
            name  = "NEXTAUTH_SECRET"
            value = random_password.nextauth_secret.result
          }

          env {
            name  = "API_TOKEN_JWT_SECRET"
            value = random_password.jwt_secret.result
          }

          env {
            name  = "REDIS_URL"
            value = "rediss://:${google_redis_instance.cache.auth_string}@${google_redis_instance.cache.host}:${google_redis_instance.cache.port}?tls.rejectUnauthorized=false"
          }

          env {
            name  = "DATABASE_URL"
            value = "postgresql://${google_sql_user.user.name}:${random_password.db_password.result}@${google_sql_database_instance.postgres.private_ip_address}:5432/${google_sql_database.database.name}?schema=public"
          }

          env {
            name  = "LANGWATCH_NLP_SERVICE"
            value = "http://langwatch-nlp-service"
          }

          env {
            name  = "LANGEVALS_ENDPOINT"
            value = "http://langevals-service"
          }

          env {
            name  = "METRICS_API_KEY"
            value = random_password.metrics_api_key.result
          }

          env {
            name  = "IS_ONPREM"
            value = "true"
          }

          # Add these env vars conditionally
          env {
            name  = "ELASTICSEARCH_NODE_URL"
            value = var.elasticsearch_url
          }

          env {
            name  = "ELASTICSEARCH_API_KEY"
            value = var.elasticsearch_api_key
          }

          env {
            name  = "IS_OPENSEARCH"
            value = var.is_opensearch == "" ? null : var.is_opensearch
          }

          resources {
            requests = {
              cpu    = "1"
              memory = "2Gi"
            }
            limits = {
              cpu    = "1"
              memory = "2Gi"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_container_cluster.primary,
    google_container_node_pool.primary_nodes,
  ]
}

# LangWatch Service
resource "kubernetes_service" "langwatch" {
  metadata {
    name = "langwatch-service"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    selector = {
      app = "langwatch"
    }

    port {
      port        = 80
      target_port = 3000
    }

    type = "LoadBalancer"
  }

  depends_on = [
    kubernetes_deployment.langwatch
  ]
}
