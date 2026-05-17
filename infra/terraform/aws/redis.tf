resource "aws_elasticache_subnet_group" "vgdp" {
  name       = "${var.cluster_name}-redis-subnet"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name        = "${var.cluster_name}-redis-sg"
  description = "Allow Redis access from EKS pods"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
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

resource "aws_elasticache_replication_group" "vgdp" {
  replication_group_id = "${var.cluster_name}-redis"
  description          = "VGDP webhook job queue and nonce coordination"

  node_type            = "cache.t3.medium"
  num_cache_clusters   = var.environment == "production" ? 3 : 1
  automatic_failover_enabled = var.environment == "production"
  multi_az_enabled     = var.environment == "production"

  engine         = "redis"
  engine_version = "7.2"
  port           = 6379

  subnet_group_name  = aws_elasticache_subnet_group.vgdp.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = {
    Name = "${var.cluster_name}-redis"
  }
}
