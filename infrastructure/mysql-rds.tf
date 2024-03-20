resource "aws_db_instance" "langwatch" {
  allocated_storage           = 5
  identifier                  = "langwatch-mysql"
  db_name                     = "langwatch_db"
  engine                      = "mysql"
  engine_version              = "8.0"
  instance_class              = "db.t4g.micro"
  parameter_group_name        = "default.mysql8.0"
  db_subnet_group_name        = aws_db_subnet_group.langwatch.name
  vpc_security_group_ids      = [aws_security_group.langwatch_db_sg.id]
  final_snapshot_identifier   = "langwatch-mysql-db-final-snapshot"
  publicly_accessible         = false
  backup_retention_period     = 7
  backup_window               = "00:00-04:00"
  maintenance_window          = "Sun:04:00-Sun:06:00"
  username                    = "langwatch_db"
  manage_master_user_password = true
  deletion_protection         = true
  storage_encrypted           = true
}

resource "aws_db_subnet_group" "langwatch" {
  name       = "langwatch-mysql-db-subnet-group"
  subnet_ids = [aws_subnet.private_subnet_1.id, aws_subnet.private_subnet_2.id]
}

resource "aws_security_group" "langwatch-mysql" {
  name        = "langwatch-mysql-db-sg"
  description = "Allow internal and external access to the DB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.langwatch[0].id, aws_security_group.bation-ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
