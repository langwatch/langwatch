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