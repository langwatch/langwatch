locals {
  aws_linux_ami = data.aws_ssm_parameter.linux_ami.value
}

resource "aws_instance" "bastion" {
  count = module.variables.profile == "lw-prod" ? 1 : 1

  ami                    = local.aws_linux_ami
  instance_type          = "t4g.nano"
  subnet_id              = aws_subnet.private_subnet_1.id
  iam_instance_profile   = aws_iam_instance_profile.bastion.name
  vpc_security_group_ids = [aws_security_group.bation-ec2.id, aws_security_group.vpc_tls.id]

  tags = {
    Name = "Bastion EC2 Instance"
  }

  lifecycle {
    ignore_changes = [
      ami
    ]
  }
}

data "aws_ssm_parameter" "linux_ami" {
  name = "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-arm64-gp2"
}

resource "aws_security_group" "bation-ec2" {
  name   = "bastion-instance-sg"
  vpc_id = aws_vpc.main.id

  egress {
    description      = "Allow Egress"
    from_port        = 0
    to_port          = 0
    protocol         = -1
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "Bastion EC2 Security Group"
  }
}


resource "aws_iam_role" "bastion" {
  name = "bastion-instance-role"

  tags = {
    Name = "bastion-instance-role"
  }

  assume_role_policy = <<EOF
{
  "Version": "2008-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": ["ec2.amazonaws.com"]
      },
      "Effect": "Allow"
    }
  ]
}
EOF
}

resource "aws_iam_instance_profile" "bastion" {
  name = "bastion-instance-profile"
  role = aws_iam_role.bastion.name

  tags = {
    Name = "bastion-instance-profile"
  }
}

# For Run Command and Session Manager
data "aws_partition" "current" {}

resource "aws_iam_role_policy_attachment" "bastion-ssm" {
  role       = aws_iam_role.bastion.id
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "bastion-cw" {
  role       = aws_iam_role.bastion.id
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/CloudWatchLogsFullAccess"
}

