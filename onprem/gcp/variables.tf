variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "europe-west3"
}

variable "zone" {
  description = "The GCP zone"
  type        = string
  default     = "europe-west3-b"
}

variable "network_name" {
  description = "The name of the VPC network"
  type        = string
  default     = "langwatch-network"
}

variable "elasticsearch_url" {
  description = "The Elasticsearch URL (optional)"
  type        = string
  default     = ""
}

variable "elasticsearch_api_key" {
  description = "The Elasticsearch API key (optional)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "is_opensearch" {
  description = "Whether the Elasticsearch cluster is OpenSearch (optional)"
  type        = string
  default     = ""
}

variable "domain" {
  description = "The domain where LangWatch will be hosted (e.g., langwatch.yourdomain.com)"
  type        = string
}
