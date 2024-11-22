# Enable Secret Manager API
resource "google_project_service" "secretmanager" {
  service = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# Enable Cloud KMS API
resource "google_project_service" "cloudkms" {
  service = "cloudkms.googleapis.com"
  disable_on_destroy = false
}

# Create Secret Manager service identity
resource "google_project_service_identity" "secretmanager" {
  provider = google-beta
  project  = var.project_id
  service  = "secretmanager.googleapis.com"

  depends_on = [
    google_project_service.secretmanager
  ]
}

# Create Cloud KMS service identity
resource "google_project_service_identity" "cloudkms" {
  provider = google-beta
  project  = var.project_id
  service  = "cloudkms.googleapis.com"

  depends_on = [
    google_project_service.cloudkms
  ]
}

# Grant the Secret Manager service account access to use the KMS key
resource "google_kms_crypto_key_iam_binding" "secret_manager_crypto_key" {
  crypto_key_id = google_kms_crypto_key.secret_key.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  members = [
    "serviceAccount:${google_project_service_identity.secretmanager.email}",
    "serviceAccount:service-${data.google_project.project.number}@gcp-sa-secretmanager.iam.gserviceaccount.com"
  ]

  depends_on = [
    google_kms_crypto_key.secret_key,
    google_project_service_identity.secretmanager
  ]
}