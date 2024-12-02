# Prometheus Helm release
resource "helm_release" "prometheus" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  name       = "prometheus"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "prometheus"

  values = [
    <<-EOT
    alertmanager:
      enabled: false

    prometheus-pushgateway:
      enabled: false

    prometheus-node-exporter:
      enabled: true

    kube-state-metrics:
      enabled: false

    server:
      retention: 90d
      persistentVolume:
        storageClass: gp3
        size: 2Gi
        accessModes:
          - ReadWriteOnce
      resources:
        requests:
          cpu: 200m
          memory: 512Mi
        limits:
          cpu: 500m
          memory: 2Gi
      image:
        repository: quay.io/prometheus/prometheus
        tag: v3.0.1
        pullPolicy: IfNotPresent
      nodeSelector:
        kubernetes.io/arch: arm64
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: kubernetes.io/arch
                operator: In
                values:
                - arm64
      service:
        type: LoadBalancer
        annotations:
          service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
          service.beta.kubernetes.io/aws-load-balancer-internal: "true"
          service.beta.kubernetes.io/aws-load-balancer-subnets: "${join(",", [aws_subnet.private_subnet_1.id, aws_subnet.private_subnet_2.id])}"
          service.beta.kubernetes.io/aws-load-balancer-security-groups: ${aws_security_group.prometheus_sg.id}

    serverFiles:
      prometheus.yml:
        scrape_configs:
          - job_name: 'langwatch'
            metrics_path: '/metrics'
            scheme: http
            static_configs:
              - targets: ['langwatch-internal']
            bearer_token: "${local.secrets_map["METRICS_API_KEY"]}"

          - job_name: 'langwatch-workers'
            metrics_path: '/workers/metrics'
            scheme: http
            static_configs:
              - targets: ['langwatch-internal']
            bearer_token: "${local.secrets_map["METRICS_API_KEY"]}"

          - job_name: 'node-exporter'
            static_configs:
              - targets: ['prometheus-prometheus-node-exporter:9100']

          - job_name: 'kubernetes-cadvisor'
            scheme: https
            tls_config:
              ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
              insecure_skip_verify: true
            bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
            kubernetes_sd_configs:
              - role: node
            relabel_configs:
              - action: labelmap
                regex: __meta_kubernetes_node_label_(.+)
              - target_label: __address__
                replacement: kubernetes.default.svc:443
              - source_labels: [__meta_kubernetes_node_name]
                regex: (.+)
                target_label: __metrics_path__
                replacement: /api/v1/nodes/$1/proxy/metrics/cadvisor
    EOT
  ]

  depends_on = [
    kubernetes_storage_class.gp3,
    aws_eks_addon.ebs_csi_driver
  ]
}

# This security group is also used by Grafana to have access to Prometheus
resource "aws_security_group" "prometheus_sg" {
  name        = "prometheus-sg"
  description = "Security group for Prometheus"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Add gp3 storage class
resource "kubernetes_storage_class" "gp3" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "gp3"
    annotations = {
      "storageclass.kubernetes.io/is-default-class" = "true"
    }
  }

  storage_provisioner    = "ebs.csi.aws.com"
  volume_binding_mode    = "WaitForFirstConsumer"
  allow_volume_expansion = true

  parameters = {
    type      = "gp3"
    encrypted = "true"
  }
}

# IAM role for EBS CSI Driver
resource "aws_iam_role" "ebs_csi" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "eks-ebs-csi-driver"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.eks[0].arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${replace(aws_iam_openid_connect_provider.eks[0].url, "https://", "")}:aud" : "sts.amazonaws.com"
          }
          StringLike = {
            "${replace(aws_iam_openid_connect_provider.eks[0].url, "https://", "")}:sub" : "system:serviceaccount:kube-system:ebs-csi-controller-sa"
          }
        }
      }
    ]
  })
}

# Add explicit policy for EBS operations
resource "aws_iam_role_policy" "ebs_csi_driver" {
  count = module.variables.profile == "lw-prod" ? 1 : 0
  name  = "ebs-csi-driver-policy"
  role  = aws_iam_role.ebs_csi[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateVolume",
          "ec2:DeleteVolume",
          "ec2:AttachVolume",
          "ec2:DetachVolume",
          "ec2:DescribeVolumes",
          "ec2:DescribeInstances",
          "ec2:DescribeSnapshots",
          "ec2:CreateSnapshot",
          "ec2:DeleteSnapshot"
        ]
        Resource = "*"
      }
    ]
  })
}

# Attach the AWS-managed policy for EBS CSI
resource "aws_iam_role_policy_attachment" "ebs_csi_policy" {
  count      = module.variables.profile == "lw-prod" ? 1 : 0
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
  role       = aws_iam_role.ebs_csi[0].name
}

# Update the EBS CSI driver addon
resource "aws_eks_addon" "ebs_csi_driver" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  cluster_name             = aws_eks_cluster.primary[0].name
  addon_name               = "aws-ebs-csi-driver"
  service_account_role_arn = aws_iam_role.ebs_csi[0].arn

  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [
    aws_eks_node_group.primary,
    aws_iam_role_policy_attachment.ebs_csi_policy,
    aws_iam_role_policy.ebs_csi_driver
  ]
}

resource "kubernetes_cluster_role" "prometheus" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "prometheus"
  }

  rule {
    api_groups = [""]
    resources  = ["nodes", "nodes/proxy", "pods"]
    verbs      = ["get", "list", "watch"]
  }

  rule {
    non_resource_urls = ["/metrics", "/metrics/cadvisor"]
    verbs             = ["get"]
  }
}

resource "kubernetes_cluster_role_binding" "prometheus" {
  count = module.variables.profile == "lw-prod" ? 1 : 0

  metadata {
    name = "prometheus"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.prometheus[0].metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = "prometheus-server"
    namespace = "default" # or whatever namespace you're using for Prometheus
  }
}
