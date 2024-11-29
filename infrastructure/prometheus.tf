locals {
  lw_secrets_map   = jsondecode(data.aws_secretsmanager_secret_version.langwatch.secret_string)
  adot_config_hash = substr(md5(local_file.adot_config[0].content), 0, 8)
}

resource "aws_prometheus_workspace" "langwatch" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  alias = "langwatch-prometheus"
  logging_configuration {
    log_group_arn = "${aws_cloudwatch_log_group.prometheus.arn}:*"
  }
}

resource "aws_cloudwatch_log_group" "prometheus" {
  name              = "/amp/prometheus"
  retention_in_days = 14
}

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

resource "local_file" "adot_config" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  content = templatefile("${path.module}/prometheus-collector/adot-config.tftpl", {
    metrics_api_key             = local.lw_secrets_map["METRICS_API_KEY"]
    aws_region                  = data.aws_region.current.name
    cluster_name                = aws_ecs_cluster.langwatch[0].name
    langwatch_service_url       = aws_alb.langwatch_alb[0].dns_name
    prometheus_remote_write_url = aws_prometheus_workspace.langwatch[0].prometheus_endpoint
  })
  filename = "${path.module}/prometheus-collector/adot-config.yaml"
}

resource "aws_ecr_repository" "adot_collector" {
  name                 = "adot-collector"
  image_tag_mutability = "IMMUTABLE"
}

resource "aws_ecs_task_definition" "adot_collector" {
  family                   = "adot-collector-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.adot_collector_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "adot-collector"
      image     = "${aws_ecr_repository.adot_collector.repository_url}:${local.adot_config_hash}"
      essential = true
      portMappings = [
        {
          containerPort = 4317
          hostPort      = 4317
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/adot-collector"
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "adot-collector"
        }
      }
    }
  ])

  depends_on = [null_resource.build_adot_collector_image[0]]
}

resource "aws_cloudwatch_log_group" "adot_collector" {
  name              = "/ecs/adot-collector"
  retention_in_days = 14
}

resource "aws_iam_role" "adot_collector_task_role" {
  name = "adot-collector-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "ecs_discovery_policy" {
  name        = "ecs-discovery-policy"
  description = "Policy for ECS/EC2 discovery for ADOT collector"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:ListClusters",
          "ecs:ListServices",
          "ecs:ListTasks",
          "ecs:DescribeContainerInstances",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:DescribeTaskDefinition",
          "ec2:DescribeInstances"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "adot_collector_ec2_discovery" {
  role       = aws_iam_role.adot_collector_task_role.name
  policy_arn = aws_iam_policy.ecs_discovery_policy.arn
}

resource "aws_iam_role_policy_attachment" "adot_collector_ecs_task_execution" {
  role       = aws_iam_role.adot_collector_task_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "adot_collector_cloudwatch" {
  role       = aws_iam_role.adot_collector_task_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_role_policy_attachment" "adot_collector_amp_remote_write" {
  role       = aws_iam_role.adot_collector_task_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonPrometheusRemoteWriteAccess"
}

resource "aws_iam_policy" "prometheus_ecs_logging" {
  name        = "prometheus-ecs-logging"
  description = "Allow ECS tasks to send logs to CloudWatch"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_logging" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.prometheus_ecs_logging.arn
}

resource "null_resource" "build_adot_collector_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  triggers = {
    adot_config_hash = local.adot_config_hash
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building ADOT collector image..."

      cd ./prometheus-collector
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true
      set +e
      image_exists=$(docker manifest inspect ${aws_ecr_repository.adot_collector.repository_url}:${local.adot_config_hash} > /dev/null 2>&1 && echo yes)
      set -e
      if [ -z "$image_exists" ]; then
        docker buildx build . --platform="linux/amd64" --push -t ${aws_ecr_repository.adot_collector.repository_url}:${local.adot_config_hash}
      fi
    EOT
  }

  depends_on = [local_file.adot_config[0], aws_ecr_repository.adot_collector]
}

resource "aws_ecs_service" "adot_collector" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  name            = "adot-collector-service"
  cluster         = aws_ecs_cluster.langwatch[0].id
  task_definition = aws_ecs_task_definition.adot_collector.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.private_subnet_1.id, aws_subnet.private_subnet_2.id]
    security_groups  = [aws_security_group.adot_collector.id]
    assign_public_ip = false
  }
}

resource "aws_security_group" "adot_collector" {
  name        = "adot-collector-sg"
  description = "Security group for ADOT collector"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "allow_ecs_to_adot" {
  type                     = "ingress"
  from_port                = 4317
  to_port                  = 4317
  protocol                 = "tcp"
  security_group_id        = aws_security_group.adot_collector.id
  source_security_group_id = aws_security_group.langwatch.id
}

resource "aws_security_group_rule" "allow_adot_to_alb" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.alb_sg.id
  source_security_group_id = aws_security_group.adot_collector.id
}