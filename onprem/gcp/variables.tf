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

variable "is_opensearch" {
  description = "Whether the Elasticsearch cluster is OpenSearch (optional)"
  type        = string
  default     = ""
}

variable "domain" {
  description = "The domain where LangWatch will be hosted (e.g., langwatch.yourdomain.com)"
  type        = string
}

variable "extra_env_vars" {
  description = "Additional environment variables in JSON format. Required vars: ELASTICSEARCH_NODE_URL, ELASTICSEARCH_API_KEY. Optional: AZURE_KEY, OPENAI_KEY, etc."
  type        = string
  sensitive   = true
}
