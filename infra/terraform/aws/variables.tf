variable "cluster_name" {
  description = "EKS cluster name and resource name prefix"
  type        = string
  default     = "vgdp"
}

variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'"
  }
}

variable "db_password" {
  description = "Master password for the RDS PostgreSQL instance. Store in AWS Secrets Manager — never commit to source control."
  type        = string
  sensitive   = true
}
