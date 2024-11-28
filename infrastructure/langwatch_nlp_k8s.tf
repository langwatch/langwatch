locals {
  langwatch_nlp_tag     = data.external.langwatch_nlp_docker_tag.result["tag"]
  langwatch_nlp_git_tag = data.external.langwatch_nlp_docker_tag.result["git_tag"]
}

# Build and push Docker image
resource "null_resource" "langwatch_nlp_docker_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  triggers = {
    image_hash = local.langwatch_nlp_tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building LangWatch NLP..."
      cd ../langwatch/langwatch_nlp
      make generate_proxy_config
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      last_tag=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} describe-images --repository-name ${aws_ecr_repository.langwatch_nlp.name} \
        --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]' --output yaml \
        | tail -n 1 | awk -F'- ' '{print $2}')
      set -e
      cache_from=""
      if [ -n "$last_tag" ]; then
        cache_from="--cache-from type=registry,ref=${aws_ecr_repository.langwatch_nlp.repository_url}:$last_tag"
      fi

      set +e
      image_exists=$(docker manifest inspect ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag} > /dev/null 2>&1 && echo yes)
      set -e
      if [ -z "$image_exists" ]; then
        docker buildx build . -f Dockerfile --platform="linux/amd64" $cache_from --cache-to type=inline --push -t ${data.aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}
        set +e
        MANIFEST=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} batch-get-image --repository-name ${aws_ecr_repository.langwatch_nlp.name} --image-ids imageTag=${local.langwatch_nlp_tag} --query 'images[].imageManifest' --output text)
        aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} put-image --repository-name ${aws_ecr_repository.langwatch_nlp.name} --image-tag ${local.langwatch_nlp_git_tag} --image-manifest "$MANIFEST"
        set -e
      fi
      cd -
    EOT

    interpreter = ["/bin/bash", "-c"]
    on_failure  = fail
  }

  depends_on = [aws_ecr_repository.langwatch_nlp]
}

# LangWatch NLP Kubernetes Deployment
resource "kubernetes_deployment" "langwatch_nlp" {
  metadata {
    name = "langwatch-nlp"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "langwatch-nlp"
      }
    }

    template {
      metadata {
        labels = {
          app = "langwatch-nlp"
        }
      }

      spec {
        container {
          name  = "langwatch-nlp"
          image = "${aws_ecr_repository.langwatch_nlp.repository_url}:${local.langwatch_nlp_tag}"
          image_pull_policy = "Always"

          port {
            container_port = 8080
          }

          env {
            name  = "LANGWATCH_ENDPOINT"
            # value = "http://langwatch-service"
            value = "https://app.langwatch.ai"
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
        }
      }
    }
  }

  depends_on = [
    aws_eks_cluster.primary,
    aws_eks_node_group.primary,
    null_resource.langwatch_nlp_docker_image
  ]
}

# LangWatch NLP Kubernetes Service
resource "kubernetes_service" "langwatch_nlp" {
  metadata {
    name = "langwatch-nlp-service"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    selector = {
      app = "langwatch-nlp"
    }

    port {
      port        = 80
      target_port = 8080
    }

    type = "ClusterIP"
  }

  depends_on = [
    kubernetes_deployment.langwatch_nlp
  ]
}

# ECR Repository (if not already defined in langwatch_nlp.tf)
resource "aws_ecr_repository" "langwatch_nlp" {
  name                 = "langwatch_nlp"
  image_tag_mutability = "IMMUTABLE"
}

data "aws_ecr_repository" "langwatch_nlp" {
  name = aws_ecr_repository.langwatch_nlp.name
}
