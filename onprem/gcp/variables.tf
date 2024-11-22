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