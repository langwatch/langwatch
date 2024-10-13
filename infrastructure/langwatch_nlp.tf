locals {
  langwatch_nlp_tag         = data.external.langwatch_nlp_docker_tag.result["tag"]
  langwatch_nlp_git_tag     = data.external.langwatch_nlp_docker_tag.result["git_tag"]
  langwatch_nlp_secrets_map = jsondecode(data.aws_secretsmanager_secret_version.langwatch_nlp.secret_string)
}

data "external" "langwatch_nlp_docker_tag" {
  program = ["${path.root}/scripts/get_langwatch_nlp_git_sha.sh"]
}

resource "aws_ecr_repository" "langwatch_nlp" {
  name                 = "langwatch_nlp"
  image_tag_mutability = "IMMUTABLE"
}

data "aws_ecr_repository" "langwatch_nlp" {
  name = aws_ecr_repository.langwatch_nlp.name
}

resource "aws_ecs_cluster" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "langwatch-nlp-cluster"
}

resource "aws_ecs_task_definition" "langwatch_nlp" {
  count                    = module.variables.profile == "lw-prod" ? 1 : 0
  family                   = "langwatch-nlp-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution_role_langwatch_nlp.arn

  container_definitions = jsonencode([
    {
      name      = "langwatch_nlp"
      image     = "${aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}"
      cpu       = 512
      memory    = 1024
      essential = true
      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
          protocol      = "tcp"
        }
      ]
      environment = [
        for k, v in local.langwatch_nlp_secrets_map : { name = k, value = v }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.langwatch_nlp_logs.name
          awslogs-region        = "eu-central-1"
          awslogs-stream-prefix = "langwatch_nlp"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/docs || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 15
      }
    }
  ])

  depends_on = [
    aws_iam_role_policy_attachment.langwatch_nlp,
    aws_cloudwatch_log_group.langwatch_nlp_logs
  ]
}

resource "aws_cloudwatch_log_group" "langwatch_nlp_logs" {
  name = "/ecs/langwatch-nlp"
}

resource "aws_ecs_service" "langwatch_nlp" {
  count           = module.variables.profile == "lw-prod" ? 1 : 0
  name            = "langwatch-nlp-service"
  cluster         = aws_ecs_cluster.langwatch_nlp[0].id
  task_definition = aws_ecs_task_definition.langwatch_nlp[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]
    security_groups  = [aws_security_group.langwatch_nlp[0].id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_alb_target_group.langwatch_nlp_tg[0].arn
    container_name   = "langwatch_nlp"
    container_port   = 8080
  }
}

resource "aws_alb_target_group" "langwatch_nlp_tg" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
  name        = "langwatch-nlp-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    path                = "/docs"
    protocol            = "HTTP"
    interval            = 30
    matcher             = "200"
  }
}

resource "aws_lb_listener" "langwatch_nlp_listener" {
  count             = module.variables.profile == "lw-prod" ? 1 : 0
  load_balancer_arn = aws_lb.langwatch_nlp_alb[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.langwatch_nlp_tg[0].arn
  }
}

resource "aws_security_group" "langwatch_nlp" {
  count  = module.variables.profile == "lw-prod" ? 1 : 0
  name   = "langwatch-nlp-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description      = "Allow Egress"
    from_port        = 0
    to_port          = 0
    protocol         = -1
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

resource "aws_lb" "langwatch_nlp_alb" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  name               = "langwatch-nlp-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.langwatch_nlp_alb_sg[0].id]
  subnets            = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]

  enable_deletion_protection = false
}

resource "aws_security_group" "langwatch_nlp_alb_sg" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
  name        = "langwatch-nlp-alb-sg"
  vpc_id      = aws_vpc.main.id
  description = "Security group for LangWatch NLP ALB"

  ingress {
    from_port   = 80
    to_port     = 80
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

resource "aws_iam_role" "ecs_task_execution_role_langwatch_nlp" {
  name = "ecs_task_execution_role_langwatch_nlp"

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

resource "aws_iam_role_policy_attachment" "langwatch_nlp" {
  role       = aws_iam_role.ecs_task_execution_role_langwatch_nlp.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_policy" "ecs_logging_langwatch_nlp" {
  name        = "ecs_logging_langwatch_nlp_policy"
  description = "Allows ECS tasks to push logs to CloudWatch"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        Effect   = "Allow",
        Resource = aws_cloudwatch_log_group.langwatch_nlp_logs.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_logging_langwatch_nlp_attach" {
  role       = aws_iam_role.ecs_task_execution_role_langwatch_nlp.name
  policy_arn = aws_iam_policy.ecs_logging_langwatch_nlp.arn
}

resource "null_resource" "langwatch_nlp_docker_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  triggers = {
    image_hash = local.langwatch_nlp_tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building LangWatch NLP..."
      cd ../langwatch/langwatch_nlp
      make generate_proxy_config
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      last_tag=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} describe-images --repository-name ${aws_ecr_repository.langwatch_nlp.name} \
        --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]' --output yaml \
        | tail -n 1 | awk -F'- ' '{print $2}')
      set -e
      cache_from=""
      if [ -n "$last_tag" ]; then
        cache_from="--cache-from type=registry,ref=${aws_ecr_repository.langwatch_nlp.repository_url}:$last_tag"
      fi

      set +e
      image_exists=$(docker manifest inspect ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag} > /dev/null 2>&1 && echo yes)
      set -e
      if [ -z "$image_exists" ]; then
        docker buildx build . -f Dockerfile --platform="linux/amd64" $cache_from --cache-to type=inline --push -t ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}
        set +e
        MANIFEST=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} batch-get-image --repository-name ${aws_ecr_repository.langwatch_nlp.name} --image-ids imageTag=${local.langwatch_nlp_tag} --query 'images[].imageManifest' --output text)
        aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} put-image --repository-name ${aws_ecr_repository.langwatch_nlp.name} --image-tag ${local.langwatch_nlp_git_tag} --image-manifest "$MANIFEST"
        set -e
      fi
      cd -
    EOT

    interpreter = ["/bin/bash", "-c"]
    on_failure  = fail
  }

  depends_on = [aws_ecr_repository.langwatch_nlp]
}
