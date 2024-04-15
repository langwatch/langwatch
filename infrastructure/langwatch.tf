locals {
  tag         = data.external.langwatch_git_tag.result["tag"]
  secrets_map = jsondecode(data.aws_secretsmanager_secret_version.langwatch.secret_string)
}

data "external" "langwatch_git_tag" {
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
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "langwatch-cluster"
}

resource "aws_ecs_task_definition" "langwatch" {
  count                    = module.variables.profile == "lw-prod" ? 1 : 0
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
      },
      environment = concat([
        for key, value in local.secrets_map : {
          name  = key
          value = value
        }
        ], [
        {
          name  = "LANGWATCH_NLP_SERVICE"
          value = aws_lambda_function_url.langwatch_nlp[0].function_url
        },
        {
          name  = "REDIS_URL"
          value = "redis://:${urlencode(jsondecode(data.aws_secretsmanager_secret_version.redis.secret_string)["password"])}@${aws_elasticache_replication_group.redis[0].primary_endpoint_address}:6379"
        }
      ]),
    },
  ])

  depends_on = [
    null_resource.langwatch_docker_image,
    aws_iam_role_policy_attachment.langwatch,
    aws_lambda_function_url.langwatch_nlp,
  ]
}

resource "aws_ecs_service" "langwatch_service" {
  count           = module.variables.profile == "lw-prod" ? 1 : 0
  name            = "langwatch-service"
  cluster         = aws_ecs_cluster.langwatch[0].id
  task_definition = aws_ecs_task_definition.langwatch[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_controller {
    type = "CODE_DEPLOY"
  }

  network_configuration {
    subnets          = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]
    security_groups  = [aws_security_group.langwatch[0].id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_alb_target_group.langwatch_blue_tg[0].arn
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
    aws_alb_listener.https_listener[0]
  ]
}

resource "null_resource" "langwatch_docker_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  triggers = {
    image_hash = local.tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building LangWatch..."
      cd ../
      if [ ! -d "./langwatch" ] || [ ! "$(ls -A ./langwatch)" ]; then
        git submodule update --init
      fi
      secrets=$(aws secretsmanager --profile ${module.variables.profile} --region ${data.aws_region.current.name} get-secret-value --secret-id ${data.aws_secretsmanager_secret.langwatch.id} | jq -r '.SecretString')
      $(echo "$${secrets}" | jq -r "to_entries|map(\"export \(.key)='\(.value)'\")|.[]|select(contains(\"NEXT_PUBLIC\"))")
      npm ci && cd langwatch/langwatch && npm ci && cd -
      npm run start:prepare
      npm run build
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      last_tag=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} describe-images --repository-name ${aws_ecr_repository.langwatch.name} \
        --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]' --output yaml \
        | tail -n 1 | awk -F'- ' '{print $2}')
      set -e
      cache_from=""
      if [ -n "$last_tag" ]; then
        cache_from="--cache-from ${aws_ecr_repository.langwatch.repository_url}:$last_tag"
      fi

      docker build . --platform="linux/amd64" $cache_from -t ${data.aws_ecr_repository.langwatch.repository_url}:${local.tag}
      docker push ${data.aws_ecr_repository.langwatch.repository_url}:${local.tag}
      cd -
    EOT

    interpreter = ["/bin/bash", "-c"]
    on_failure  = fail
  }

  depends_on = [aws_ecr_repository.langwatch]
}

resource "aws_codedeploy_app" "langwatch_app" {
  count            = module.variables.profile == "lw-prod" ? 1 : 0
  name             = "langwatch-app"
  compute_platform = "ECS"
}

resource "aws_codestarnotifications_notification_rule" "langwatch-deploy" {
  count          = module.variables.profile == "lw-prod" ? 1 : 0
  detail_type    = "FULL"
  event_type_ids = ["codedeploy-application-deployment-started", "codedeploy-application-deployment-failed", "codedeploy-application-deployment-succeeded"]

  name     = "langwatch-codedeploy-notifications"
  resource = aws_codedeploy_app.langwatch_app[0].arn

  target {
    type    = "AWSChatbotSlack"
    address = awscc_chatbot_slack_channel_configuration.langwatch[0].arn
  }
}

resource "awscc_chatbot_slack_channel_configuration" "langwatch" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  configuration_name = "langwatch-chatbot"
  iam_role_arn       = awscc_iam_role.langwatch.arn
  slack_workspace_id = "T067B8XMC0M" # langwatch
  slack_channel_id   = "C06JQLW1HE2" # #dev
}

resource "aws_codedeploy_deployment_group" "langwatch_dg" {
  count                  = module.variables.profile == "lw-prod" ? 1 : 0
  app_name               = aws_codedeploy_app.langwatch_app[0].name
  deployment_group_name  = "langwatch-dg"
  service_role_arn       = aws_iam_role.codedeploy_role.arn
  deployment_config_name = "CodeDeployDefault.ECSAllAtOnce"

  deployment_style {
    deployment_type   = "BLUE_GREEN"
    deployment_option = "WITH_TRAFFIC_CONTROL"
  }

  ecs_service {
    cluster_name = aws_ecs_cluster.langwatch[0].name
    service_name = aws_ecs_service.langwatch_service[0].name
  }

  load_balancer_info {
    target_group_pair_info {
      prod_traffic_route {
        listener_arns = [aws_alb_listener.https_listener[0].arn]
      }

      target_group {
        name = aws_alb_target_group.langwatch_blue_tg[0].name
      }

      target_group {
        name = aws_alb_target_group.langwatch_green_tg[0].name
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
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  name               = "langwatch-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg[0].id]
  subnets            = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]

  enable_deletion_protection = true
}

resource "aws_alb_listener" "https_listener" {
  count             = module.variables.profile == "lw-prod" ? 1 : 0
  load_balancer_arn = aws_alb.langwatch_alb[0].arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate.cert[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.langwatch_blue_tg[0].arn
  }

  lifecycle {
    ignore_changes = [
      default_action, # Updated by deployments
    ]
  }
}

resource "aws_alb_target_group" "langwatch_blue_tg" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
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
  count       = module.variables.profile == "lw-prod" ? 1 : 0
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

resource "aws_security_group" "langwatch" {
  count  = module.variables.profile == "lw-prod" ? 1 : 1
  name   = "langwatch-app-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    description     = "HTTP from ALB and bastion ec2"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg[0].id, aws_security_group.bation-ec2.id]
  }

  egress {
    description      = "Allow Egress"
    from_port        = 0
    to_port          = 0
    protocol         = -1
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "Langwatch app sg"
  }
}

resource "aws_security_group" "alb_sg" {
  count       = module.variables.profile == "lw-prod" ? 1 : 1
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

  ingress {
    from_port   = 3000
    to_port     = 3000
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
  count             = module.variables.profile == "lw-prod" ? 1 : 0
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
  name              = "/ecs/langwatch"
  retention_in_days = 365
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

resource "awscc_iam_role" "langwatch" {
  role_name = "ChatBot-Channel-Role"
  assume_role_policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = ""
        Principal = {
          Service = "chatbot.amazonaws.com"
        }
      },
    ]
  })
  managed_policy_arns = ["arn:aws:iam::aws:policy/AWSResourceExplorerReadOnlyAccess"]
}
