locals {
  # cache.m7g.large vCPU: 2, Memory: 6,38 GiB, Network Performance: Up to 12.5 Gigabit => 274.48 USD/month (on-demand price for 2 instances)
  # cache.t4g.small vCPU: 2, Memory: 1,37 GiB, Network Performance: Up to 5 Gigabit =>  26.28 USD/month (on-demand price for 1 instance)
  redis_node_type = module.variables.profile == "lw-prod" ? "cache.m7g.large" : "cache.t4g.small"
  redis_num_nodes = module.variables.profile == "lw-prod" ? 2 : 2
}

resource "aws_security_group" "redis_sg" {
  name   = "redis-sg"
  vpc_id = aws_vpc.main.id

  # Ingress rule allowing all traffic from the ECS Security Group
  egress {
    from_port       = 0
    to_port         = 0
    protocol        = "-1" # This signifies all protocols
    security_groups = [aws_security_group.alb_sg.id]
  }

  # Ingress rule allowing Redis port from the ECS Security Group
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  tags = {
    Name = "ElastiCache Redis Security Group"
  }
}

resource "aws_elasticache_cluster" "redis_cluster" {
  # count                      = module.variables.profile == "lw-prod" ? 1 : 0
  cluster_id                 = "langwatch-redis-cluster"
  engine                     = "redis"
  engine_version             = "7.2"
  node_type                  = local.redis_node_type
  num_cache_nodes            = local.redis_num_nodes
  parameter_group_name       = "default.redis7.x"
  port                       = 6379
  security_group_ids         = [aws_security_group.redis_sg.id]
  transit_encryption_enabled = true

  tags = {
    Name = "langwatch-redis-cluster"
  }
}

