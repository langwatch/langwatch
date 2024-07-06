import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as eks from "aws-cdk-lib/aws-eks";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { KubectlV30Layer } from "@aws-cdk/lambda-layer-kubectl-v30";
import * as iam from "aws-cdk-lib/aws-iam";

export class LangWatchAwsMarketplaceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const nodeCountParam = new cdk.CfnParameter(this, "KubernetesNodeCount", {
      type: "Number",
      default: 1,
      minValue: 1,
      maxValue: 10,
      description: "Number of nodes in the Kubernetes EKS cluster",
    });

    // Create a VPC
    const vpc = new ec2.Vpc(this, "LangWatchVPC", {
      maxAzs: 2,
    });

    // Create an EKS cluster
    const cluster = new eks.Cluster(this, "LangWatchCluster", {
      version: eks.KubernetesVersion.V1_30,
      vpc,
      defaultCapacity: 0,
      kubectlLayer: new KubectlV30Layer(this, "KubectlLayer"),
    });

    const nodegroup = cluster.addNodegroupCapacity("ManagedNodes", {
      instanceTypes: [new ec2.InstanceType("m5.large")],
      minSize: nodeCountParam.valueAsNumber,
      maxSize: nodeCountParam.valueAsNumber,
      desiredSize: nodeCountParam.valueAsNumber,
    });

    // Use the predefined service-linked role for AWS Marketplace
    const currentAccountRoleArn = `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/OrganizationAccountAccessRole`;

    // Create an IAM role object from the service-linked role ARN
    const currentAccountRole = iam.Role.fromRoleArn(
      this,
      "CurrentRoleArn",
      currentAccountRoleArn
    );

    // Update the aws-auth ConfigMap
    const awsAuth = new eks.AwsAuth(this, "AwsAuth", { cluster });
    awsAuth.addRoleMapping(currentAccountRole, {
      groups: ["system:masters"],
    });

    awsAuth.addRoleMapping(nodegroup.role, {
      username: "system:node:{{EC2PrivateDNSName}}",
      groups: ["system:bootstrappers", "system:nodes"],
    });

    // Add ClusterRoleBinding for kube-apiserver-kubelet-client
    cluster.addManifest("kube-apiserver-kubelet-client-binding", {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: {
        name: "kube-apiserver-kubelet-client-binding",
      },
      subjects: [
        {
          kind: "User",
          name: "kube-apiserver-kubelet-client",
          apiGroup: "rbac.authorization.k8s.io",
        },
      ],
      roleRef: {
        kind: "ClusterRole",
        name: "system:masters", // name: "system:nodes",?
        apiGroup: "rbac.authorization.k8s.io",
      },
    });

    this.setupLangEvals(cluster);
    this.setupFluentd(cluster);
  }

  setupLangEvals(cluster: eks.Cluster) {
    // Add a Kubernetes manifest for the langevals service
    cluster.addManifest("langevals", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "langevals" },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "langevals" } },
        template: {
          metadata: { labels: { app: "langevals" } },
          spec: {
            containers: [
              {
                name: "langevals",
                image: "langwatch/langevals:latest",
                ports: [{ containerPort: 8000 }],
              },
            ],
          },
        },
      },
    });

    // Add a Kubernetes service to expose the langevals deployment
    cluster.addManifest("langevals-service", {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "langevals-service" },
      spec: {
        selector: { app: "langevals" },
        ports: [{ port: 80, targetPort: 8000 }],
        type: "LoadBalancer",
      },
    });
  }

  // To capture logs from the kubernetes containers
  setupFluentd(cluster: eks.Cluster) {
    const fluentdServiceAccount = cluster.addServiceAccount("fluentd", {
      name: "fluentd",
      namespace: "kube-system",
    });

    fluentdServiceAccount.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
        ],
        resources: ["arn:aws:logs:*:*:*"],
      })
    );

    const fluentdClusterRole = cluster.addManifest("fluentd-clusterrole", {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRole",
      metadata: { name: "fluentd-clusterrole" },
      rules: [
        {
          apiGroups: [""],
          resources: ["pods", "namespaces"],
          verbs: ["get", "list", "watch"],
        },
        {
          apiGroups: [""],
          resources: ["pods/log"],
          verbs: ["get", "list", "watch"],
        },
      ],
    });

    const fluentdClusterRoleBinding = cluster.addManifest(
      "fluentd-clusterrolebinding",
      {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRoleBinding",
        metadata: { name: "fluentd-clusterrolebinding" },
        subjects: [
          {
            kind: "ServiceAccount",
            name: fluentdServiceAccount.serviceAccountName,
            namespace: "kube-system",
          },
        ],
        roleRef: {
          kind: "ClusterRole",
          name: "fluentd-clusterrole",
          apiGroup: "rbac.authorization.k8s.io",
        },
      }
    );

    // Ensure the ClusterRoleBinding is created after the ClusterRole
    fluentdClusterRoleBinding.node.addDependency(fluentdClusterRole);

    // Create a ConfigMap for Fluentd configuration
    cluster.addManifest("fluentd-config", {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "fluentd-config", namespace: "kube-system" },
      data: {
        "fluent.conf": `
        <source>
        @type tail
        path /var/log/containers/*.log
        pos_file /var/log/fluentd-containers.log.pos
        tag kubernetes.*
        <parse>
          @type none
        </parse>
      </source>

      <filter kubernetes.**>
        @type kubernetes_metadata
      </filter>

      <filter kubernetes.**>
        @type record_transformer
        enable_ruby true
        <record>
          pod_name \${record['kubernetes']['pod_name']}
        </record>
      </filter>

      <match kubernetes.**>
        @type cloudwatch_logs
        log_group_name /aws/eks/${cluster.clusterName}/cluster
        log_stream_name_key pod_name
        auto_create_stream true
        retention_in_days 7
        <buffer>
          @type file
          path /var/log/fluentd-buffers/kubernetes.*.buffer
          flush_interval 5s
          flush_at_shutdown true
          retry_forever true
          retry_max_interval 30
        </buffer>
      </match>
        `,
      },
    });

    // Create a DaemonSet for Fluentd
    cluster.addManifest("fluentd-daemonset", {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      metadata: { name: "fluentd-cloudwatch", namespace: "kube-system" },
      spec: {
        selector: { matchLabels: { name: "fluentd-cloudwatch" } },
        template: {
          metadata: { labels: { name: "fluentd-cloudwatch" } },
          spec: {
            serviceAccountName: "fluentd",
            tolerations: [
              { key: "node-role.kubernetes.io/master", effect: "NoSchedule" },
              {
                key: "node.kubernetes.io/not-ready",
                effect: "NoExecute",
                operator: "Exists",
              },
              {
                key: "node.kubernetes.io/unreachable",
                effect: "NoExecute",
                operator: "Exists",
              },
            ],
            containers: [
              {
                name: "fluentd-cloudwatch",
                image:
                  "fluent/fluentd-kubernetes-daemonset:v1.17.0-debian-cloudwatch-1.0",
                resources: {
                  limits: { memory: "200Mi" },
                  requests: { cpu: "100m", memory: "200Mi" },
                },
                env: [
                  { name: "FLUENT_UID", value: "0" },
                  { name: "AWS_REGION", value: cdk.Aws.REGION },
                  { name: "CLUSTER_NAME", value: cluster.clusterName },
                ],
                volumeMounts: [
                  { name: "varlog", mountPath: "/var/log" },
                  {
                    name: "varlibdockercontainers",
                    mountPath: "/var/lib/docker/containers",
                    readOnly: true,
                  },
                  {
                    name: "fluentdconf",
                    mountPath: "/fluentd/etc/fluent.conf",
                    subPath: "fluent.conf",
                  },
                ],
              },
            ],
            terminationGracePeriodSeconds: 30,
            volumes: [
              { name: "varlog", hostPath: { path: "/var/log" } },
              {
                name: "varlibdockercontainers",
                hostPath: { path: "/var/lib/docker/containers" },
              },
              { name: "fluentdconf", configMap: { name: "fluentd-config" } },
            ],
          },
        },
      },
    });
  }
}
