# Redis instance
resource "google_redis_instance" "cache" {
  name           = "langwatch-redis-${random_id.suffix.hex}"
  tier           = "BASIC"
  memory_size_gb = 1

  region = var.region

  authorized_network = google_compute_network.vpc.id
  connect_mode      = "PRIVATE_SERVICE_ACCESS"

  redis_version = "REDIS_7_2"

  auth_enabled = true

  transit_encryption_mode = "SERVER_AUTHENTICATION"

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 2
        minutes = 0
      }
    }
  }

  customer_managed_key = google_kms_crypto_key.redis_key.id

  depends_on = [
    google_service_networking_connection.private_vpc_connection
  ]
}

# Generate Redis password
resource "random_password" "redis_password" {
  length  = 16
  special = false
}

# Store Redis password in Secret Manager
resource "google_secret_manager_secret" "redis_password" {
  secret_id = "redis-password-${random_id.suffix.hex}"

  replication {
    auto {
      customer_managed_encryption {
        kms_key_name = google_kms_crypto_key.secret_key.id
      }
    }
  }
}

resource "google_secret_manager_secret_version" "redis_password" {
  secret      = google_secret_manager_secret.redis_password.id
  secret_data = random_password.redis_password.result
}

# Update the Redis URL in langwatch.tf to use the generated auth string
output "redis_auth_string" {
  value     = google_redis_instance.cache.auth_string
  sensitive = true
}