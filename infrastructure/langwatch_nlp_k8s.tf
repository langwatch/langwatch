locals {
  langwatch_nlp_k8s_tag     = data.external.langwatch_nlp_k8s_docker_tag.result["tag"]
  langwatch_nlp_k8s_git_tag = data.external.langwatch_nlp_k8s_docker_tag.result["git_tag"]
}

data "external" "langwatch_nlp_k8s_docker_tag" {
  program = ["${path.root}/scripts/get_langwatch_nlp_git_sha.sh"]
}

# Build and push Docker image
resource "null_resource" "langwatch_nlp_k8s_docker_image" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  triggers = {
    image_hash = local.langwatch_nlp_k8s_tag
  }

  provisioner "local-exec" {
    command = <<EOT
      set -eo pipefail

      echo "Building LangWatch NLP..."
      cd ../langwatch/langwatch_nlp
      aws ecr get-login-password --profile ${module.variables.profile} --region ${data.aws_region.current.name} | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com || true

      set +e
      last_tag=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} describe-images --repository-name ${aws_ecr_repository.langwatch_nlp_k8s.name} \
        --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[0]' --output yaml \
        | tail -n 1 | awk -F'- ' '{print $2}')
      set -e
      cache_from=""
      if [ -n "$last_tag" ]; then
        cache_from="--cache-from type=registry,ref=${aws_ecr_repository.langwatch_nlp_k8s.repository_url}:$last_tag"
      fi

      set +e
      image_exists=$(docker manifest inspect ${data.aws_ecr_repository.langwatch_nlp_k8s.repository_url}:${local.langwatch_nlp_k8s_tag} > /dev/null 2>&1 && echo yes)
      set -e
      if [ -z "$image_exists" ]; then
        docker buildx build . -f Dockerfile --platform="linux/arm64" $cache_from --cache-to type=inline --push -t ${data.aws_ecr_repository.langwatch_nlp_k8s.repository_url}:${local.langwatch_nlp_k8s_tag}
        set +e
        MANIFEST=$(aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} batch-get-image --repository-name ${aws_ecr_repository.langwatch_nlp_k8s.name} --image-ids imageTag=${local.langwatch_nlp_k8s_tag} --query 'images[].imageManifest' --output text)
        aws ecr --profile ${module.variables.profile} --region ${data.aws_region.current.name} put-image --repository-name ${aws_ecr_repository.langwatch_nlp_k8s.name} --image-tag ${local.langwatch_nlp_k8s_git_tag} --image-manifest "$MANIFEST"
        set -e
      fi
      cd -
    EOT

    interpreter = ["/bin/bash", "-c"]
    on_failure  = fail
  }

  depends_on = [aws_ecr_repository.langwatch_nlp_k8s]
}

# LangWatch NLP Kubernetes Deployment
resource "kubernetes_deployment" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "langwatch-nlp"
    annotations = {
      "deployment-timestamp" = timestamp()
    }
  }

  spec {
    replicas               = 1
    revision_history_limit = 1

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
        # Security context for KVM access, necessary for us to run Firecracker
        security_context {
          run_as_user = 0
        }

        container {
          name              = "langwatch-nlp"
          image             = "${aws_ecr_repository.langwatch_nlp_k8s.repository_url}:${local.langwatch_nlp_k8s_tag}"
          image_pull_policy = "Always"

          security_context {
            # We need privileged access to run Firecracker
            privileged = true
          }

          # Mount the KVM device
          volume_mount {
            name       = "kvm-device"
            mount_path = "/dev/kvm"
          }

          resources {
            requests = {
              cpu    = "1000m"
              memory = "4Gi"
            }
            limits = {
              cpu    = "1000m"
              memory = "4Gi"
            }
          }

          env {
            name  = "LANGWATCH_ENDPOINT"
            value = "http://langwatch-internal"
          }
        }

        # Jut the KVM device volume
        volume {
          name = "kvm-device"
          host_path {
            path = "/dev/kvm"
          }
        }

        node_selector = {
          "kubernetes.io/arch" = "arm64"
        }
      }
    }
  }

  depends_on = [
    aws_eks_cluster.primary,
    aws_eks_node_group.secondary,
    null_resource.langwatch_nlp_k8s_docker_image
  ]
}

# LangWatch NLP Kubernetes Service
resource "kubernetes_service" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

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
    kubernetes_deployment.langwatch_nlp[0]
  ]
}

# ECR Repository (if not already defined in langwatch_nlp.tf)
resource "aws_ecr_repository" "langwatch_nlp_k8s" {
  name                 = "langwatch_nlp_k8s"
  image_tag_mutability = "IMMUTABLE"
}

data "aws_ecr_repository" "langwatch_nlp_k8s" {
  name = aws_ecr_repository.langwatch_nlp_k8s.name
}

resource "aws_ecr_lifecycle_policy" "langwatch_nlp_k8s" {
  repository = aws_ecr_repository.langwatch_nlp_k8s.name

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
