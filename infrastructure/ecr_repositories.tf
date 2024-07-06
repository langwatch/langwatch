# Repositories for onprem to store the docker images

resource "aws_ecr_repository" "onprem_langwatch_saas" {
  name                 = "onprem_langwatch_saas"
  image_tag_mutability = "MUTABLE"
}

data "aws_ecr_repository" "onprem_langwatch_saas" {
  name = aws_ecr_repository.onprem_langwatch_saas.name
}

resource "aws_ecr_repository" "onprem_langwatch_nlp" {
  name                 = "onprem_langwatch_nlp"
  image_tag_mutability = "MUTABLE"
}

data "aws_ecr_repository" "onprem_langwatch_nlp" {
  name = aws_ecr_repository.onprem_langwatch_nlp.name
}
