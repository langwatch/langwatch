resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "main-vpc"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name = "main-igw"
  }
}

resource "aws_route_table" "public_route_table" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "public-route-table"
  }
}

resource "aws_subnet" "public_subnet_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "eu-central-1a"
  map_public_ip_on_launch = true
  tags = {
    Name = "public-subnet-1"
  }
}

resource "aws_subnet" "public_subnet_2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "eu-central-1b"
  map_public_ip_on_launch = true
  tags = {
    Name = "public-subnet-2"
  }
}

resource "aws_route_table_association" "public_subnet_1_association" {
  subnet_id      = aws_subnet.public_subnet_1.id
  route_table_id = aws_route_table.public_route_table.id
}

resource "aws_route_table_association" "public_subnet_2_association" {
  subnet_id      = aws_subnet.public_subnet_2.id
  route_table_id = aws_route_table.public_route_table.id
}

# Private subnets and route table (no internet access) - for RDS, ElastiCache
resource "aws_subnet" "private_subnet_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.3.0/24"
  availability_zone       = "eu-central-1a"
  map_public_ip_on_launch = false
  tags = {
    Name = "private-subnet-1"
  }
}

resource "aws_subnet" "private_subnet_2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.4.0/24"
  availability_zone       = "eu-central-1b"
  map_public_ip_on_launch = false
  tags = {
    Name = "private-subnet-2"
  }
}

resource "aws_route_table" "private_route_table" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name = "private-route-table"
  }
}

resource "aws_route_table_association" "private_subnet_1_association" {
  subnet_id      = aws_subnet.private_subnet_1.id
  route_table_id = aws_route_table.private_route_table.id
}

resource "aws_route_table_association" "private_subnet_2_association" {
  subnet_id      = aws_subnet.private_subnet_2.id
  route_table_id = aws_route_table.private_route_table.id
}

# NatGW with EIP to Allow Egress from Private networks
resource "aws_eip" "nat_eip" {
  tags = {
    Name = "nat-eip"
  }
}

resource "aws_nat_gateway" "nat_gw" {
  allocation_id = aws_eip.nat_eip.id
  subnet_id     = aws_subnet.public_subnet_1.id
  tags = {
    Name = "main-nat-gw"
  }
}

resource "aws_route" "private_route_to_nat" {
  route_table_id         = aws_route_table.private_route_table.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat_gw.id
}

# For VPC Endpoints
resource "aws_security_group" "vpc_tls" {
  name_prefix = "main-vpc-tls-sg"
  description = "Allow TLS inbound traffic"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "TLS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  tags = {
    Name = "Main VPC Endpoints SG - TLS"
  }
}

resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  name = "/aws/vpc/flow-logs"
}

resource "aws_iam_role" "flow_log_role" {
  name = "vpc-flow-log-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = "sts:AssumeRole",
        Principal = {
          Service = "vpc-flow-logs.amazonaws.com"
        },
        Effect = "Allow",
        Sid    = "",
      },
    ],
  })
}

resource "aws_iam_policy" "flow_log_policy" {
  name = "vpc-flow-log-policy"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource = "arn:aws:logs:*:*:log-group:/aws/vpc/flow-logs:*",
        Effect   = "Allow",
      },
    ],
  })
}

resource "aws_iam_role_policy_attachment" "flow_log_policy_attachment" {
  role       = aws_iam_role.flow_log_role.name
  policy_arn = aws_iam_policy.flow_log_policy.arn
}

resource "aws_flow_log" "vpc_flow_log" {
  count           = module.variables.profile == "lw-prod" ? 1 : 0
  log_destination = aws_cloudwatch_log_group.vpc_flow_logs.arn
  iam_role_arn    = aws_iam_role.flow_log_role.arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.main.id
}

data "aws_vpc" "default" {
  default = true
}

resource "aws_flow_log" "default_vpc_flow_log" {
  count           = module.variables.profile == "lw-prod" ? 1 : 0
  log_destination = aws_cloudwatch_log_group.vpc_flow_logs.arn
  iam_role_arn    = aws_iam_role.flow_log_role.arn
  traffic_type    = "ALL"
  vpc_id          = data.aws_vpc.default.id
}
