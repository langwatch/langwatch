# locals {
#   lw_secrets_map = jsondecode(data.aws_secretsmanager_secret_version.langwatch.secret_string)
# }

# # Create Amazon Managed Prometheus workspace
# resource "aws_prometheus_workspace" "langwatch" {
#   count = module.variables.profile == "lw-prod" ? 1 : 0
#   alias = "langwatch-prometheus"
# }

# # IAM role for Prometheus
# resource "aws_iam_role" "prometheus_role" {
#   name = "prometheus-role"

#   assume_role_policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Action = "sts:AssumeRole"
#         Effect = "Allow"
#         Principal = {
#           Service = "amp.amazonaws.com"
#         }
#       }
#     ]
#   })
# }

# # IAM policy for Prometheus to access ECS and EC2
# resource "aws_iam_role_policy" "prometheus_policy" {
#   name = "prometheus-policy"
#   role = aws_iam_role.prometheus_role.id

#   policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [
#       {
#         Effect = "Allow"
#         Action = [
#           "ecs:ListClusters",
#           "ecs:ListServices",
#           "ecs:DescribeServices",
#           "ec2:DescribeInstances"
#         ]
#         Resource = "*"
#       }
#     ]
#   })
# }

# # Prometheus scrape configuration
# resource "aws_prometheus_rule_group_namespace" "langwatch_scrape_config" {
#   name         = "langwatch-scrape-config"
#   workspace_id = aws_prometheus_workspace.langwatch[0].id

#   data = <<EOF
# groups:
#   - name: langwatch
#     rules:
#       - record: up
#         expr: up{job="langwatch"}
# EOF
# }

# # Security group rule to allow Prometheus to access the ECS service
# resource "aws_security_group_rule" "allow_prometheus" {
#   type                     = "ingress"
#   from_port                = 3000
#   to_port                  = 3000
#   protocol                 = "tcp"
#   security_group_id        = aws_security_group.langwatch.id
#   source_security_group_id = aws_security_group.prometheus_sg.id
# }

# # Security group for Prometheus
# resource "aws_security_group" "prometheus_sg" {
#   name        = "prometheus-sg"
#   description = "Security group for Prometheus"
#   vpc_id      = aws_vpc.main.id

#   egress {
#     from_port   = 0
#     to_port     = 0
#     protocol    = "-1"
#     cidr_blocks = ["0.0.0.0/0"]
#   }
# }

# # Prometheus configuration
# resource "aws_prometheus_scraper" "langwatch_main" {
#   count = module.variables.profile == "lw-prod" ? 1 : 0
#   source {
#     ecs {
#       cluster_arn = aws_ecs_cluster.langwatch[0].arn
#       subnet_ids  = aws_subnet.private[*].id
#     }
#   }

#   destination {
#     amp {
#       workspace_arn = aws_prometheus_workspace.langwatch[0].arn
#     }
#   }

#   scrape_configuration = <<EOT
# global:
#   scrape_interval: 15s

# scrape_configs:
#   - job_name: 'langwatch'
#     metrics_path: '/metrics'
#     scheme: http
#     authorization:
#       type: Bearer
#       credentials: '${local.lw_secrets_map["METRICS_API_KEY"]}'
#     ec2_sd_configs:
#       - region: ${data.aws_region.current.name}
#         port: 3000
#     relabel_configs:
#       - source_labels: [__meta_ec2_tag_aws_ecs_cluster]
#         regex: ${aws_ecs_cluster.langwatch[0].name}
#         action: keep
#       - source_labels: [__meta_ec2_private_ip]
#         target_label: instance
#       - target_label: service_type
#         replacement: main
# EOT
# }

# # Prometheus scraper for workers
# resource "aws_prometheus_scraper" "langwatch_workers" {
#   count = module.variables.profile == "lw-prod" ? 1 : 0
#   source {
#     ecs {
#       cluster_arn = aws_ecs_cluster.langwatch[0].arn
#       subnet_ids  = aws_subnet.private[*].id
#     }
#   }

#   destination {
#     amp {
#       workspace_arn = aws_prometheus_workspace.langwatch[0].arn
#     }
#   }

#   scrape_configuration = <<EOT
# global:
#   scrape_interval: 15s

# scrape_configs:
#   - job_name: 'langwatch-workers'
#     metrics_path: '/workers/metrics'
#     scheme: http
#     authorization:
#       type: Bearer
#       credentials: '${local.lw_secrets_map["METRICS_API_KEY"]}'
#     ec2_sd_configs:
#       - region: ${data.aws_region.current.name}
#         port: 3000
#     relabel_configs:
#       - source_labels: [__meta_ec2_tag_aws_ecs_cluster]
#         regex: ${aws_ecs_cluster.langwatch[0].name}
#         action: keep
#       - source_labels: [__meta_ec2_private_ip]
#         target_label: instance
#       - target_label: service_type
#         replacement: worker
# EOT
# }
