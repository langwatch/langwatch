# KMS keyring
resource "google_kms_key_ring" "keyring" {
  name     = "langwatch-keyring-${random_id.suffix.hex}"
  location = "global"
}

# KMS key for secrets
resource "google_kms_crypto_key" "secret_key" {
  name     = "secret-key"
  key_ring = google_kms_key_ring.keyring.id

  lifecycle {
    prevent_destroy = false
  }
}