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
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "metabase"
}

data "aws_secretsmanager_secret_version" "metabase" {
  count     = module.variables.profile == "lw-prod" ? 1 : 0
  secret_id = data.aws_secretsmanager_secret.metabase[0].id
}
