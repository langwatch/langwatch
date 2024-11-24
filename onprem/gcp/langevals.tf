# Read version from package.json
data "local_file" "package_json" {
  filename = "${path.module}/../../package.json"
}

locals {
  langwatch_version = jsondecode(data.local_file.package_json.content).version
}

# LangEvals Deployment
resource "kubernetes_deployment" "langevals" {
  metadata {
    name = "langevals"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "langevals"
      }
    }

    template {
      metadata {
        labels = {
          app = "langevals"
        }
      }

      spec {
        container {
          name              = "langevals"
          image             = "europe-west3-docker.pkg.dev/langwatch/onprem/langevals:${local.langwatch_version}"
          image_pull_policy = "Always"

          port {
            container_port = 8000
          }

          resources {
            requests = {
              cpu    = "2"
              memory = "4Gi"
            }
            limits = {
              cpu    = "2"
              memory = "4Gi"
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

# LangEvals Service
resource "kubernetes_service" "langevals" {
  metadata {
    name = "langevals-service"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    selector = {
      app = "langevals"
    }

    port {
      port        = 80
      target_port = 8000
    }

    type = "ClusterIP"
  }

  depends_on = [
    kubernetes_deployment.langevals
  ]
}
