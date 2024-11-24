# Cloud SQL instance
resource "google_sql_database_instance" "postgres" {
  name             = "langwatch-postgres-${random_id.suffix.hex}"
  database_version = "POSTGRES_17"
  region           = var.region

  settings {
    tier = "db-f1-micro"
    edition = "ENTERPRISE"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }

    backup_configuration {
      enabled    = true
      start_time = "02:00"
    }
  }

  deletion_protection = false # Set to true for production

  depends_on = [
    google_service_networking_connection.private_vpc_connection
  ]
}

# Create database
resource "google_sql_database" "database" {
  name     = "langwatch_db"
  instance = google_sql_database_instance.postgres.name
}

# Generate database password
resource "random_password" "db_password" {
  length  = 16
  special = false
}

# Create database user
resource "google_sql_user" "user" {
  name     = "langwatch_db"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}

# Store database password in Secret Manager
resource "google_secret_manager_secret" "db_password" {
  secret_id = "db-password-${random_id.suffix.hex}"

  replication {
    auto {
      customer_managed_encryption {
        kms_key_name = google_kms_crypto_key.secret_key.id
      }
    }
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}