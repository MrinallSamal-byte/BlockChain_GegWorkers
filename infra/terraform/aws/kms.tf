resource "aws_kms_key" "eks" {
  description             = "KMS key for EKS node volume encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${var.cluster_name}-eks-key"
  }
}

resource "aws_kms_alias" "eks" {
  name          = "alias/${var.cluster_name}-eks"
  target_key_id = aws_kms_key.eks.key_id
}

resource "aws_kms_key" "rds" {
  description             = "KMS key for RDS PostgreSQL encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${var.cluster_name}-rds-key"
  }
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${var.cluster_name}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_kms_key" "validator_secrets" {
  description             = "KMS key for encrypting validator private key and API secrets in AWS Secrets Manager"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${var.cluster_name}-validator-secrets-key"
  }
}

resource "aws_kms_alias" "validator_secrets" {
  name          = "alias/${var.cluster_name}-validator-secrets"
  target_key_id = aws_kms_key.validator_secrets.key_id
}
