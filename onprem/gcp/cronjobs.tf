# Create CronJobs for periodic tasks
resource "kubernetes_cron_job_v1" "topic_clustering" {
  metadata {
    name = "topic-clustering"
  }

  spec {
    schedule = "0 0 * * *"  # At midnight every day

    job_template {
      metadata {
        name = "topic-clustering"
      }

      spec {
        template {
          metadata {
            name = "topic-clustering"
          }

          spec {
            container {
              name  = "curl"
              image = "curlimages/curl:latest"

              command = ["/bin/sh", "-c"]
              args    = ["curl -X GET http://langwatch-service/api/schedule_topic_clustering"]
            }

            restart_policy = "OnFailure"
          }
        }
      }
    }
  }

  depends_on = [
    kubernetes_deployment.langwatch
  ]
}

resource "kubernetes_cron_job_v1" "alert_triggers" {
  metadata {
    name = "alert-triggers"
  }

  spec {
    schedule = "*/3 * * * *"  # Every 3 minutes

    job_template {
      metadata {
        name = "alert-triggers"
      }

      spec {
        template {
          metadata {
            name = "alert-triggers"
          }

          spec {
            container {
              name  = "curl"
              image = "curlimages/curl:latest"

              command = ["/bin/sh", "-c"]
              args    = ["curl -X GET http://langwatch-service/api/triggers"]
            }

            restart_policy = "OnFailure"
          }
        }
      }
    }
  }

  depends_on = [
    kubernetes_deployment.langwatch
  ]
}