locals {
  tag = data.external.git_tag.result["tag"]
}

data "external" "git_tag" {
  program = ["${path.root}/scripts/get_langwatch_sass_git_sha.sh"]
}

resource "aws_ecr_repository" "langwatch" {
  name                 = "langwatch"
  image_tag_mutability = "IMMUTABLE"
}

data "aws_ecr_repository" "langwatch" {
  name = aws_ecr_repository.langwatch.name
}

resource "aws_ecr_lifecycle_policy" "langwatch" {
  repository = aws_ecr_repository.langwatch.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain only 3 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 3
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecs_cluster" "langwatch" {
  name = "langwatch-cluster"
}

resource "aws_ecs_task_definition" "langwatch" {
  family                   = "langwatch-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  cpu                      = 1024
  memory                   = 2048

  container_definitions = jsonencode([
    {
      name      = "langwatch-container"
      image     = "${aws_ecr_repository.langwatch.repository_url}:${local.tag}"
      cpu       = 1024
      memory    = 2048
      essential = true
      portMappings = [
        {
          containerPort = 3000
        },
      ],
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/langwatch"
          awslogs-region        = "eu-central-1"
          awslogs-stream-prefix = "langwatch"
        }
      }
    },
  ])

  depends_on = [
    null_resource.docker_image,
    aws_iam_role_policy_attachment.langwatch,
  ]
}

resource "aws_ecs_service" "langwatch_service" {
  name            = "langwatch-service"
  cluster         = aws_ecs_cluster.langwatch.id
  task_definition = aws_ecs_task_definition.langwatch.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_controller {
    type = "CODE_DEPLOY"
  }

  network_configuration {
    subnets          = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]
    security_groups  = [aws_security_group.alb_sg.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_alb_target_group.langwatch_blue_tg.arn
    container_name   = "langwatch-container"
    container_port   = 3000
  }

  lifecycle {
    ignore_changes = [
      desired_count,   # Updated possibly by auto scaling
      task_definition, # Updated by deployments
      load_balancer,   # Updated by deployments
    ]
  }

  depends_on = [
    aws_alb_listener.http_listener,
    aws_alb_listener.https_listener
  ]
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "null_resource" "docker_image" {
  triggers = {
    image_hash = local.tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building LangWatch..."
      cd ../
      git submodule update --init
      npm ci && cd langwatch/langwatch && npm ci && cd -
      npm run start:prepare
      npm run build
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true
      docker pull ${data.aws_ecr_repository.langwatch.repository_url}:latest || true
      docker build . --platform="linux/amd64" -t ${data.aws_ecr_repository.langwatch.repository_url}:${local.tag}
      docker tag ${data.aws_ecr_repository.langwatch.repository_url}:${local.tag} ${data.aws_ecr_repository.langwatch.repository_url}:latest
      docker push ${data.aws_ecr_repository.langwatch.repository_url}:${local.tag}
      docker push ${data.aws_ecr_repository.langwatch.repository_url}:latest
      cd -
    EOT
  }

  depends_on = [aws_ecr_repository.langwatch]
}

resource "aws_codedeploy_app" "langwatch_app" {
  name             = "langwatch-app"
  compute_platform = "ECS"
}

resource "aws_codedeploy_deployment_group" "langwatch_dg" {
  app_name               = aws_codedeploy_app.langwatch_app.name
  deployment_group_name  = "langwatch-dg"
  service_role_arn       = aws_iam_role.codedeploy_role.arn
  deployment_config_name = "CodeDeployDefault.ECSAllAtOnce"

  deployment_style {
    deployment_type   = "BLUE_GREEN"
    deployment_option = "WITH_TRAFFIC_CONTROL"
  }

  ecs_service {
    cluster_name = aws_ecs_cluster.langwatch.name
    service_name = aws_ecs_service.langwatch_service.name
  }

  load_balancer_info {
    target_group_pair_info {
      prod_traffic_route {
        listener_arns = [aws_alb_listener.https_listener.arn, aws_alb_listener.http_listener.arn]
      }

      target_group {
        name = aws_alb_target_group.langwatch_blue_tg.name
      }

      target_group {
        name = aws_alb_target_group.langwatch_green_tg.name
      }
    }
  }

  blue_green_deployment_config {
    deployment_ready_option {
      action_on_timeout = "CONTINUE_DEPLOYMENT"
    }

    terminate_blue_instances_on_deployment_success {
      action = "TERMINATE"
    }
  }

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM", "DEPLOYMENT_STOP_ON_REQUEST"]
  }
}

resource "aws_alb" "langwatch_alb" {
  name               = "langwatch-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]

  enable_deletion_protection = true
}

resource "aws_alb_listener" "http_listener" {
  load_balancer_arn = aws_alb.langwatch_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.langwatch_blue_tg.arn
  }
}

resource "aws_alb_listener" "https_listener" {
  load_balancer_arn = aws_alb.langwatch_alb.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate.cert.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.langwatch_blue_tg.arn
  }
}

resource "aws_alb_target_group" "langwatch_blue_tg" {
  name        = "langwatch-blue-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    path                = "/"
    protocol            = "HTTP"
    interval            = 30
    matcher             = "200"
  }
}

resource "aws_alb_target_group" "langwatch_green_tg" {
  name        = "langwatch-green-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    path                = "/"
    protocol            = "HTTP"
    interval            = 30
    matcher             = "200"
  }
}

resource "aws_security_group" "alb_sg" {
  name        = "langwatch-alb-sg"
  description = "Allow web access to alb"
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
}

resource "aws_acm_certificate" "cert" {
  domain_name       = "app.langwatch.ai"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Environment = "production"
  }
}

resource "aws_cloudwatch_log_group" "langwatch" {
  name = "/ecs/langwatch"
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "ecs_task_execution_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Effect = "Allow"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "langwatch" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_policy" "ecs_logs_policy" {
  name        = "ecsLogsPolicy"
  path        = "/"
  description = "Allow ECS tasks to create and manage logs in CloudWatch."

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
        Resource = "arn:aws:logs:eu-central-1:${data.aws_caller_identity.current.account_id}:*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_logs_policy_attachment" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.ecs_logs_policy.arn
}

resource "aws_iam_role" "codedeploy_role" {
  name = "codedeploy_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Principal = {
          Service = "codedeploy.amazonaws.com"
        }
        Effect = "Allow"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "codedeploy_role_ecs" {
  role       = aws_iam_role.codedeploy_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSCodeDeployRoleForECSLimited"
}

resource "aws_iam_role_policy_attachment" "codedeploy_role_ecs_full_access" {
  role       = aws_iam_role.codedeploy_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonECS_FullAccess"
}

resource "aws_iam_policy" "codedeploy_ecs_policy" {
  name        = "codedeploy_ecs_policy"
  description = "Policy for CodeDeploy to access ECS services"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ecs:DescribeServices",
          "ecs:UpdateService",
          "ecs:DescribeTaskSets",
          "ecs:CreateTaskSet",
          "ecs:DeleteTaskSet"
        ],
        Resource = "*",
        Effect   = "Allow"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "codedeploy_ecs_policy_attachment" {
  role       = aws_iam_role.codedeploy_role.name
  policy_arn = aws_iam_policy.codedeploy_ecs_policy.arn
}
