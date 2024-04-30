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

data "aws_secretsmanager_secret" "langwatch_nlp" {
  name = "langwatch_nlp_secrets"
}

data "aws_secretsmanager_secret_version" "langwatch_nlp" {
  secret_id = data.aws_secretsmanager_secret.langwatch_nlp.id
}

data "aws_secretsmanager_secret" "redis" {
  name = "langwatch_redis"
}

data "aws_secretsmanager_secret_version" "redis" {
  secret_id = data.aws_secretsmanager_secret.redis.id
}

data "aws_secretsmanager_secret" "metabase" {
  name = "metabase"
}

data "aws_secretsmanager_secret_version" "metabase" {
  secret_id = data.aws_secretsmanager_secret.metabase.id
}
