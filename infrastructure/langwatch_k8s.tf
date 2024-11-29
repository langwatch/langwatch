locals {
  tag         = data.external.langwatch_docker_tag.result["tag"]
  git_tag     = data.external.langwatch_docker_tag.result["git_tag"]
  secrets_map = jsondecode(data.aws_secretsmanager_secret_version.langwatch.secret_string)
}

data "external" "langwatch_docker_tag" {
  program = ["${path.root}/scripts/get_langwatch_saas_git_sha.sh"]
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

      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      image_exists=$(docker manifest inspect ${data.aws_ecr_repository.langwatch.repository_url}:${local.tag} > /dev/null 2>&1 && echo yes)
      set -e
      if [ -z "$image_exists" ]; then
        build_args=""
        if [ ! -z "$SENTRY_AUTH_TOKEN" ]; then
          build_args="--build-arg SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN"
        fi
        docker buildx build . --platform="linux/arm64" $build_args --push -t ${data.aws_ecr_repository.langwatch.repository_url}:${local.tag}
        set +e
        MANIFEST=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} batch-get-image --repository-name ${aws_ecr_repository.langwatch.name} --image-ids imageTag=${local.tag} --query 'images[].imageManifest' --output text)
        aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} put-image --repository-name ${aws_ecr_repository.langwatch.name} --image-tag ${local.git_tag} --image-manifest "$MANIFEST"
        set -e
      fi
      cd -
    EOT

    interpreter = ["/bin/bash", "-c"]
    on_failure  = fail
  }

  depends_on = [aws_ecr_repository.langwatch]
}

# LangWatch Kubernetes Deployment
resource "kubernetes_deployment" "langwatch" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  wait_for_rollout = true

  metadata {
    name = "langwatch"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "langwatch"
      }
    }

    template {
      metadata {
        labels = {
          app = "langwatch"
        }
      }

      spec {
        container {
          name  = "langwatch"
          image = "${aws_ecr_repository.langwatch.repository_url}:${local.tag}"
          image_pull_policy = "Always"

          port {
            container_port = 3000
          }

          env {
            name  = "LANGWATCH_NLP_SERVICE"
            value = "http://langwatchnlp-service"
          }

          env {
            name  = "REDIS_URL"
            value = "rediss://:${urlencode(jsondecode(data.aws_secretsmanager_secret_version.redis.secret_string)["password"])}@${aws_elasticache_replication_group.redis[0].primary_endpoint_address}:6379"
          }

          env {
            name  = "DATABASE_URL"
            value = "postgresql://langwatch_db:${urlencode(jsondecode(data.aws_secretsmanager_secret_version.langwatch-pg.secret_string)["password"])}@${aws_db_instance.langwatch-pg.endpoint}/langwatch_db?sslmode=allow&schema=langwatch_db"
          }

          dynamic "env" {
            for_each = nonsensitive(local.secrets_map)
            content {
              name  = env.key
              value = sensitive(env.value)
            }
          }

          resources {
            requests = {
              cpu    = "1"
              memory = "2Gi"
            }
            limits = {
              cpu    = "1"
              memory = "2Gi"
            }
          }

          liveness_probe {
            http_get {
              path = "/"
              port = 3000
            }
            initial_delay_seconds = 30
            period_seconds       = 30
            timeout_seconds     = 5
            failure_threshold   = 3
          }
        }
      }
    }
  }

  depends_on = [
    aws_eks_cluster.primary,
    aws_eks_node_group.primary,
    null_resource.langwatch_docker_image
  ]
}

# LangWatch Service with LoadBalancer
resource "kubernetes_service" "langwatch" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "langwatch-service"
    annotations = {
      "service.beta.kubernetes.io/aws-load-balancer-type" = "nlb"
      "service.beta.kubernetes.io/aws-load-balancer-subnets" = join(",", [aws_subnet.public_subnet_1.id])
    }
  }

  spec {
    selector = {
      app = "langwatch"
    }

    port {
      port        = 80
      target_port = 3000
    }

    type = "LoadBalancer"
  }

  depends_on = [
    kubernetes_deployment.langwatch
  ]
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