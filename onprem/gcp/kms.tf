# KMS keyring
resource "google_kms_key_ring" "keyring" {
  name     = "langwatch-keyring-${random_id.suffix.hex}"
  location = "global"
}

# Regional KMS keyring for Redis
resource "google_kms_key_ring" "regional_keyring" {
  name     = "langwatch-regional-keyring-${random_id.suffix.hex}"
  location = var.region
}

# Global KMS key for secrets
resource "google_kms_crypto_key" "secret_key" {
  name     = "secret-key"
  key_ring = google_kms_key_ring.keyring.id

  lifecycle {
    prevent_destroy = true
  }
}

# Regional KMS key for Redis
resource "google_kms_crypto_key" "redis_key" {
  name     = "redis-key"
  key_ring = google_kms_key_ring.regional_keyring.id

  lifecycle {
    prevent_destroy = false
  }
}