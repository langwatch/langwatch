# LangWatch NLP Deployment
resource "kubernetes_deployment" "langwatch_nlp" {
  metadata {
    name = "langwatch-nlp"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "langwatch-nlp"
      }
    }

    template {
      metadata {
        labels = {
          app = "langwatch-nlp"
        }
      }

      spec {
        container {
          name  = "langwatch-nlp"
          image = "europe-west3-docker.pkg.dev/langwatch/onprem/langwatch_nlp:${local.langwatch_version}"
          image_pull_policy = "Always"

          port {
            container_port = 8080
          }

          env {
            name  = "LANGWATCH_ENDPOINT"
            value = "http://langwatch-service"
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
    google_container_node_pool.primary_nodes
  ]
}

# LangWatch NLP Service
resource "kubernetes_service" "langwatch_nlp" {
  metadata {
    name = "langwatch-nlp-service"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    selector = {
      app = "langwatch-nlp"
    }

    port {
      port        = 80
      target_port = 8080
    }

    type = "ClusterIP"
  }

  depends_on = [
    kubernetes_deployment.langwatch_nlp
  ]
}