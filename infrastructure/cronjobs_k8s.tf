# CronJobs for periodic tasks
resource "kubernetes_cron_job_v1" "topic_clustering" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "topic-clustering"
  }

  spec {
    schedule = "0 0 * * *"  # At midnight every day
    concurrency_policy = "Replace"
    failed_jobs_history_limit = 3
    successful_jobs_history_limit = 3

    job_template {
      metadata {
        name = "topic-clustering"
      }

      spec {
        template {
          metadata {
            labels = {
              app = "langwatch-cronjob"
            }
          }

          spec {
            container {
              name  = "curl"
              image = "curlimages/curl:latest"

              command = ["/bin/sh", "-c"]
              args    = ["curl -i -H 'Authorization: Bearer ${local.secrets_map["CRON_API_KEY"]}' -X GET http://langwatch-service/api/schedule_topic_clustering"]

              resources {
                requests = {
                  cpu    = "100m"
                  memory = "64Mi"
                }
                limits = {
                  cpu    = "100m"
                  memory = "64Mi"
                }
              }
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
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "alert-triggers"
  }

  spec {
    schedule = "*/3 * * * *"  # Every 3 minutes
    concurrency_policy = "Replace"
    failed_jobs_history_limit = 3
    successful_jobs_history_limit = 3

    job_template {
      metadata {
        name = "alert-triggers"
      }

      spec {
        template {
          metadata {
            labels = {
              app = "langwatch-cronjob"
            }
          }

          spec {
            container {
              name  = "curl"
              image = "curlimages/curl:latest"

              command = ["/bin/sh", "-c"]
              args    = ["curl -i -H 'Authorization: Bearer ${local.secrets_map["CRON_API_KEY"]}' -X GET http://langwatch-service/api/triggers"]

              resources {
                requests = {
                  cpu    = "100m"
                  memory = "64Mi"
                }
                limits = {
                  cpu    = "100m"
                  memory = "64Mi"
                }
              }
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