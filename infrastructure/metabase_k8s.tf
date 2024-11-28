provider "helm" {
  kubernetes {
    host                   = module.variables.profile == "lw-prod" ? aws_eks_cluster.primary[0].endpoint : null
    cluster_ca_certificate = module.variables.profile == "lw-prod" ? base64decode(aws_eks_cluster.primary[0].certificate_authority[0].data) : null

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.primary[0].name, "--region", data.aws_region.current.name, "--profile", module.variables.profile]
      command     = "aws"
    }
  }
}

# Metabase PostgreSQL Database
resource "aws_db_instance" "metabase" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  identifier         = "metabase-db"
  storage_type       = "gp2"
  engine             = "postgres"
  engine_version     = "16.3"
  instance_class     = "db.t4g.micro"
  allocated_storage  = 5
  username           = "metabase"
  password           = jsondecode(data.aws_secretsmanager_secret_version.metabase[0].secret_string)["MB_DB_PASS"]
  db_name            = "metabaseappdb"
  backup_window      = "00:00-04:00"
  maintenance_window = "Sun:04:00-Sun:06:00"

  deletion_protection = true
  storage_encrypted   = true

  db_subnet_group_name   = aws_db_subnet_group.metabase[0].name
  vpc_security_group_ids = [aws_security_group.metabase-db[0].id]
  publicly_accessible    = false
}

resource "aws_db_subnet_group" "metabase" {
  count      = module.variables.profile == "lw-prod" ? 1 : 0
  name       = "metabase-db-subnet-group"
  subnet_ids = [aws_subnet.private_subnet_1.id, aws_subnet.private_subnet_2.id]
}

resource "aws_security_group" "metabase-db" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
  name        = "metabase-db-sg"
  description = "Allow internal and external access to the DB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id, aws_security_group.bation-ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Metabase Kubernetes Deployment
resource "kubernetes_deployment" "metabase" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "metabase"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "metabase"
      }
    }

    template {
      metadata {
        labels = {
          app = "metabase"
        }
      }

      spec {
        container {
          name  = "metabase"
          image = "metabase/metabase:${local.metabase_tag}"
          image_pull_policy = "Always"

          port {
            container_port = 3000
          }

          env {
            name  = "MB_DB_TYPE"
            value = "postgres"
          }

          env {
            name  = "MB_DB_DBNAME"
            value = "metabaseappdb"
          }

          env {
            name  = "MB_DB_PORT"
            value = "5432"
          }

          env {
            name  = "MB_DB_USER"
            value = "metabase"
          }

          env {
            name = "MB_DB_PASS"
            value = jsondecode(data.aws_secretsmanager_secret_version.metabase[0].secret_string)["MB_DB_PASS"]
          }

          env {
            name = "MB_ENCRYPTION_SECRET_KEY"
            value = jsondecode(data.aws_secretsmanager_secret_version.metabase[0].secret_string)["MB_ENCRYPTION_SECRET_KEY"]
          }

          env {
            name  = "MB_DB_HOST"
            value = aws_db_instance.metabase[0].address
          }

          resources {
            requests = {
              cpu    = "500m"
              memory = "1Gi"
            }
            limits = {
              cpu    = "500m"
              memory = "1Gi"
            }
          }

          liveness_probe {
            http_get {
              path = "/api/health"
              port = 3000
            }
            initial_delay_seconds = 60
            period_seconds       = 30
            timeout_seconds     = 5
            failure_threshold   = 3
          }
        }
      }
    }
  }

  depends_on = [
    aws_eks_cluster.primary,
    aws_eks_node_group.primary,
    aws_db_instance.metabase
  ]
}

# Metabase Service
resource "kubernetes_service" "metabase" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "metabase-service"
  }

  spec {
    selector = {
      app = "metabase"
    }

    port {
      port        = 80
      target_port = 3000
    }

    type = "ClusterIP"
  }

  depends_on = [
    kubernetes_deployment.metabase
  ]
}

# Add Ingress resource
resource "kubernetes_ingress_v1" "metabase" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "metabase-ingress"
    annotations = {
      "kubernetes.io/ingress.class"                = "alb"
      "alb.ingress.kubernetes.io/scheme"           = "internet-facing"
      "alb.ingress.kubernetes.io/target-type"      = "ip"
      "alb.ingress.kubernetes.io/subnets"          = join(",", [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id])
      "alb.ingress.kubernetes.io/security-groups"   = aws_security_group.alb[0].id
    }
  }

  spec {
    rule {
      http {
        path {
          path = "/*"
          backend {
            service {
              name = kubernetes_service.metabase[0].metadata[0].name
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }
}

# Add ALB Security Group
resource "aws_security_group" "alb" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
  name        = "metabase-alb-sg"
  description = "Security group for Metabase ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "metabase-alb-sg"
  }
}
