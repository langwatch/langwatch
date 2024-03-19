data "aws_secretsmanager_secret" "langevals" {
  name = "langevals_secrets"
}

data "aws_secretsmanager_secret_version" "langevals" {
  secret_id = data.aws_secretsmanager_secret.langevals.id
}

data "aws_secretsmanager_secret" "langwatch" {
  name = "langwatch_secrets"
}

data "aws_secretsmanager_secret_version" "langwatch" {
  secret_id = data.aws_secretsmanager_secret.langwatch.id
}
