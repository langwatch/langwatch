# Enable GKE API
resource "google_project_service" "gke" {
  service            = "container.googleapis.com"
  disable_on_destroy = false
}

# GKE cluster
resource "google_container_cluster" "primary" {
  name     = "langwatch-cluster-${random_id.suffix.hex}"
  location = var.zone

  # We can't create a cluster with no node pool defined, but we want to only use
  # separately managed node pools. So we create the smallest possible default
  # node pool and immediately delete it.
  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name

  # Enable Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Configure private cluster
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Configure master authorized networks
  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "0.0.0.0/0"
      display_name = "All"
    }
  }

  ip_allocation_policy {
    cluster_ipv4_cidr_block  = "/16"
    services_ipv4_cidr_block = "/16"
    stack_type               = "IPV4"
  }

  depends_on = [
    google_project_service.gke,
    google_compute_subnetwork.subnet
  ]
}

# Separately Managed Node Pool
resource "google_container_node_pool" "primary_nodes" {
  name       = "langwatch-node-pool"
  location   = var.zone
  cluster    = google_container_cluster.primary.name
  node_count = 1

  node_config {
    preemptible  = false
    machine_type = "e2-standard-8"

    # Google recommends custom service accounts that have cloud-platform scope and permissions granted via IAM Roles.
    service_account = google_service_account.gke_sa.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# Create GKE service account
resource "google_service_account" "gke_sa" {
  account_id   = "gke-sa-${random_id.suffix.hex}"
  display_name = "GKE Service Account"
}

# Grant necessary permissions to GKE service account
resource "google_project_iam_member" "gke_sa_roles" {
  for_each = toset([
    "roles/cloudkms.cryptoKeyEncrypterDecrypter", # For Secret Manager
    "roles/secretmanager.secretAccessor",         # For accessing secrets
    "roles/monitoring.viewer",                    # For monitoring
    "roles/logging.logWriter",                    # For logging
    "roles/redis.viewer",                         # For Redis access
    "roles/cloudsql.client"                       # For Cloud SQL access
  ])

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.gke_sa.email}"
}
