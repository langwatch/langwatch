output "redis_host" {
  value = google_redis_instance.cache.host
}

output "redis_port" {
  value = google_redis_instance.cache.port
}

output "postgres_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "postgres_private_ip" {
  value = google_sql_database_instance.postgres.private_ip_address
}

output "kubernetes_cluster_name" {
  value       = google_container_cluster.primary.name
  description = "GKE Cluster Name"
}

output "kubernetes_cluster_host" {
  value       = google_container_cluster.primary.endpoint
  description = "GKE Cluster Host"
}

output "gke_service_account_email" {
  value       = google_service_account.gke_sa.email
  description = "GKE Service Account Email"
}