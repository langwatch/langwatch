locals {
  # cache.m7g.large vCPU: 2, Memory: 6,38 GiB, Network Performance: Up to 12.5 Gigabit => 274.48 USD/month (on-demand price for 2 instances)
  # cache.t4g.small vCPU: 2, Memory: 1,37 GiB, Network Performance: Up to 5 Gigabit =>  26.28 USD/month (on-demand price for 1 instance)
  # cache.t4g.micro vCPU: 2, Memory: 0.5 GiB, Network Performance: Up to 5 Gigabit =>  13.14 USD/month (on-demand price for 1 instance)
  redis_node_type = "cache.t4g.micro"
  redis_num_nodes = 1
}

resource "aws_security_group" "redis" {
  name   = "redis-sg"
  vpc_id = aws_vpc.main.id

  # Ingress rule allowing all traffic from the ECS Security Group
  egress {
    from_port       = 0
    to_port         = 0
    protocol        = "-1" # This signifies all protocols
    security_groups = [aws_security_group.langwatch[0].id]
  }

  # Ingress rule allowing Redis port from the ECS Security Group
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.langwatch[0].id]
  }

  tags = {
    Name = "ElastiCache Redis Security Group"
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  name        = "langwatch-redis-subnet-group"
  description = "Subnet group for ElastiCache Redis"
  subnet_ids  = [aws_subnet.private_subnet_1.id, aws_subnet.private_subnet_2.id]
}

resource "aws_elasticache_replication_group" "redis" {
  count = module.variables.profile == "lw-prod" ? 1 : 1

  replication_group_id = "langwatch-redis-replication-group"
  description          = "langwatch-redis-replication-group"
  node_type            = local.redis_node_type
  num_cache_clusters   = local.redis_num_nodes
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]
  parameter_group_name = "default.redis7"
  engine_version       = "7.1"

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  auth_token                 = random_password.redis.result
  auth_token_update_strategy = "SET"


  tags = {
    Name = "langwatch-redis-cluster"
  }
}

# random password
resource "random_password" "redis" {
  length  = 16
  special = true
}

