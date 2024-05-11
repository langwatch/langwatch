locals {
  metabase_tag = "v0.49.7"
}

resource "aws_ecs_cluster" "metabase" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "metabase-cluster"
}

resource "aws_ecs_task_definition" "metabase" {
  count                    = module.variables.profile == "lw-prod" ? 1 : 0
  family                   = "metabase-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution_role_metabase.arn

  container_definitions = jsonencode([
    {
      name      = "metabase"
      image     = "metabase/metabase:${local.metabase_tag}"
      cpu       = 512
      memory    = 1024
      essential = true
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "MB_DB_TYPE", value = "postgres" },
        { name = "MB_DB_DBNAME", value = "metabaseappdb" },
        { name = "MB_DB_PORT", value = "5432" },
        { name = "MB_DB_USER", value = "metabase" },
        { name = "MB_DB_PASS", value = jsondecode(data.aws_secretsmanager_secret_version.metabase.secret_string)["MB_DB_PASS"] },
        { name = "MB_ENCRYPTION_SECRET_KEY", value = jsondecode(data.aws_secretsmanager_secret_version.metabase.secret_string)["MB_ENCRYPTION_SECRET_KEY"] },
        { name = "MB_DB_HOST", value = aws_db_instance.metabase[0].address }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.metabase_logs.name
          awslogs-region        = "eu-central-1"
          awslogs-stream-prefix = "langwatch"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 15
      }
    }
  ])

  depends_on = [
    aws_db_instance.metabase[0],
    aws_iam_role_policy_attachment.metabase,
    aws_cloudwatch_log_group.metabase_logs,
  ]
}

resource "aws_cloudwatch_log_group" "metabase_logs" {
  name = "/ecs/metabase"
}

resource "aws_ecs_service" "metabase" {
  count           = module.variables.profile == "lw-prod" ? 1 : 0
  name            = "metabase-service"
  cluster         = aws_ecs_cluster.metabase[0].id
  task_definition = aws_ecs_task_definition.metabase[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]
    security_groups  = [aws_security_group.metabase[0].id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_alb_target_group.metabase_tg[0].arn
    container_name   = "metabase"
    container_port   = 3000
  }
}

resource "aws_alb_target_group" "metabase_tg" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
  name        = "metabase-tg"
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

resource "aws_lb_listener" "metabase_listener" {
  count             = module.variables.profile == "lw-prod" ? 1 : 0
  load_balancer_arn = aws_lb.metabase_alb[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.metabase_tg[0].arn
  }
}

resource "aws_security_group" "metabase" {
  count  = module.variables.profile == "lw-prod" ? 1 : 0
  name   = "metabase-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 3000
    to_port     = 3000
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

resource "aws_lb" "metabase_alb" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  name               = "metabase-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.metabase_alb_sg[0].id]
  subnets            = [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id]

  enable_deletion_protection = false
}

resource "aws_security_group" "metabase_alb_sg" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
  name        = "metabase-alb-sg"
  vpc_id      = aws_vpc.main.id
  description = "Security group for Metabase ALB"

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

resource "aws_db_instance" "metabase" {
  count              = module.variables.profile == "lw-prod" ? 1 : 0
  identifier         = "metabase-db"
  storage_type       = "gp2"
  engine             = "postgres"
  engine_version     = "16.2"
  instance_class     = "db.t4g.micro"
  allocated_storage  = 5
  username           = "metabase"
  password           = jsondecode(data.aws_secretsmanager_secret_version.metabase.secret_string)["MB_DB_PASS"]
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
    security_groups = [aws_security_group.metabase[0].id, aws_security_group.bation-ec2.id]
    cidr_blocks     = []
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "ecs_task_execution_role_metabase" {
  name = "ecs_task_execution_role_metabase"

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

resource "aws_iam_role_policy_attachment" "metabase" {
  role       = aws_iam_role.ecs_task_execution_role_metabase.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_policy" "ecs_logging_metabase" {
  name        = "ecs_logging_metabase_policy"
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
        Resource = aws_cloudwatch_log_group.metabase_logs.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_logging_metabase_attach" {
  role       = aws_iam_role.ecs_task_execution_role_metabase.name
  policy_arn = aws_iam_policy.ecs_logging_metabase.arn
}
