locals {
  langwatch_nlp_tag         = data.external.langwatch_nlp_docker_tag.result["tag"]
  langwatch_nlp_git_tag     = data.external.langwatch_nlp_docker_tag.result["git_tag"]
  langwatch_nlp_secrets_map = jsondecode(data.aws_secretsmanager_secret_version.langwatch_nlp.secret_string)
}

resource "kubernetes_namespace" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  metadata {
    name = "langwatch-nlp"
  }
}

data "external" "langwatch_nlp_docker_tag" {
  program = ["${path.root}/scripts/get_langwatch_nlp_git_sha.sh"]
}

resource "aws_ecr_repository" "langwatch_nlp" {
  name                 = "langwatch_nlp"
  image_tag_mutability = "IMMUTABLE"
}

data "aws_ecr_repository" "langwatch_nlp" {
  name = aws_ecr_repository.langwatch_nlp.name
}

resource "kubernetes_deployment" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  metadata {
    name      = "langwatch-nlp"
    namespace = kubernetes_namespace.langwatch_nlp[0].metadata[0].name
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

          port {
            container_port = 8080
          }

          resources {
            limits = {
              cpu    = "1"
              memory = "2Gi"
            }
            requests = {
              cpu    = "500m"
              memory = "1Gi"
            }
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map.langwatch_nlp[0].metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.langwatch_nlp[0].metadata[0].name
            }
          }

          liveness_probe {
            http_get {
              path = "/docs"
              port = 8080
            }
            initial_delay_seconds = 15
            period_seconds        = 30
          }
        }
      }
    }
  }

  depends_on = [
    kubernetes_namespace.langwatch_nlp[0],
    aws_eks_node_group.langwatch,
    null_resource.langwatch_nlp_docker_image[0]
  ]
}

resource "kubernetes_service" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  metadata {
    name      = "langwatch-nlp"
    namespace = kubernetes_namespace.langwatch_nlp[0].metadata[0].name
    annotations = {
      "service.beta.kubernetes.io/aws-load-balancer-type"     = "nlb"
      "service.beta.kubernetes.io/aws-load-balancer-internal" = "false"
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

    # type = "ClusterIP"
    type = "LoadBalancer"
  }
}

resource "kubernetes_config_map" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  metadata {
    name      = "langwatch-nlp-config"
    namespace = kubernetes_namespace.langwatch_nlp[0].metadata[0].name
  }

  data = {
    # Add non-sensitive environment variables here
  }
}

resource "kubernetes_secret" "langwatch_nlp" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  metadata {
    name      = "langwatch-nlp-secrets"
    namespace = kubernetes_namespace.langwatch_nlp[0].metadata[0].name
  }

  data = local.langwatch_nlp_secrets_map
}

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

resource "aws_iam_role" "eks_pod_execution_role" {
  name = "eks-pod-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_pod_execution_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSFargatePodExecutionRolePolicy"
  role       = aws_iam_role.eks_pod_execution_role.name
}

resource "aws_cloudwatch_log_group" "langwatch_nlp_logs" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "/eks/langwatch-nlp"
}

resource "aws_security_group" "langwatch_nlp" {
  count  = module.variables.profile == "lw-prod" ? 1 : 0
  name   = "langwatch-nlp-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description      = "Allow Egress"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}
