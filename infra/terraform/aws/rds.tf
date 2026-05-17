resource "aws_db_subnet_group" "vgdp" {
  name       = "${var.cluster_name}-rds-subnet"
  subnet_ids = module.vpc.private_subnets

  tags = {
    Name = "${var.cluster_name}-rds-subnet"
  }
}

resource "aws_security_group" "rds" {
  name        = "${var.cluster_name}-rds-sg"
  description = "Allow PostgreSQL access from EKS pods"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "vgdp" {
  identifier = "${var.cluster_name}-postgres"

  engine               = "postgres"
  engine_version       = "16"
  instance_class       = "db.t3.medium"
  allocated_storage    = 100
  max_allocated_storage = 500
  storage_type         = "gp3"
  storage_encrypted    = true
  kms_key_id           = aws_kms_key.rds.arn

  db_name  = "vgdp"
  username = "vgdp_admin"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.vgdp.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az               = var.environment == "production"
  publicly_accessible    = false
  deletion_protection    = var.environment == "production"
  skip_final_snapshot    = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${var.cluster_name}-final-snapshot" : null

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  performance_insights_enabled = true

  tags = {
    Name = "${var.cluster_name}-postgres"
  }
}
