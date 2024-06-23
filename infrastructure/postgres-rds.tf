resource "aws_db_instance" "langwatch-pg" {
  allocated_storage           = 5
  identifier                  = "langwatch-pg"
  db_name                     = "langwatch_db"
  engine                      = "postgres"
  engine_version              = "16.3"
  instance_class              = "db.t4g.micro"
  parameter_group_name        = "default.postgres16"
  db_subnet_group_name        = aws_db_subnet_group.langwatch.name
  vpc_security_group_ids      = [aws_security_group.langwatch-pg.id]
  final_snapshot_identifier   = "langwatch-pg-db-final-snapshot"
  publicly_accessible         = module.variables.profile == "lw-dev" ? true : false
  backup_retention_period     = 7
  backup_window               = "00:00-04:00"
  maintenance_window          = "Sun:04:00-Sun:06:00"
  username                    = "langwatch_db"
  manage_master_user_password = true
  deletion_protection         = true
  storage_encrypted           = true
}

resource "aws_db_subnet_group" "langwatch-pg" {
  name = "langwatch-pg-db-subnet-group"
  subnet_ids = (module.variables.profile == "lw-dev" ?
    [aws_subnet.public_subnet_1.id, aws_subnet.public_subnet_2.id] :
    [aws_subnet.private_subnet_1.id, aws_subnet.private_subnet_2.id]
  )
}

resource "aws_security_group" "langwatch-pg" {
  name        = "langwatch-pg-db-sg"
  description = "Allow internal and external access to the DB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.langwatch.id, aws_security_group.metabase.id, aws_security_group.bation-ec2.id]
    cidr_blocks     = module.variables.profile == "lw-dev" ? ["0.0.0.0/0"] : []
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
