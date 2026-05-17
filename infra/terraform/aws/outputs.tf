output "cluster_endpoint" {
  description = "EKS cluster API server endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "db_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = aws_db_instance.vgdp.endpoint
  sensitive   = true
}

output "db_name" {
  description = "RDS database name"
  value       = aws_db_instance.vgdp.db_name
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_replication_group.vgdp.primary_endpoint_address
  sensitive   = true
}

output "validator_secrets_kms_key_arn" {
  description = "KMS key ARN for validator private key encryption"
  value       = aws_kms_key.validator_secrets.arn
}

output "rds_kms_key_arn" {
  description = "KMS key ARN used for RDS encryption"
  value       = aws_kms_key.rds.arn
}
