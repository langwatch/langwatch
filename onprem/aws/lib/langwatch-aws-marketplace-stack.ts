import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

// cloudwatch too for container logs
import * as eks from "aws-cdk-lib/aws-eks";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as rds from "aws-cdk-lib/aws-rds";
import { KubectlV30Layer } from "@aws-cdk/lambda-layer-kubectl-v30";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cr from "aws-cdk-lib/custom-resources";

import langWatchPackageJson from "../../../package.json";
import { setupFluentd } from "./fluentd";

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

    const domainParam = new cdk.CfnParameter(this, "SubDomainName", {
      type: "String",
      description:
        "The subdomain name where LangWatch will be hosted (e.g., langwatch.yourdomain.com)",
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

    const { redis, redisPassword } = this.setupRedis(vpc, cluster);
    const { postgres, postgresPassword } = this.setupPostgres(vpc, cluster);
    const { elasticPassword } = this.setupElasticsearch(vpc, cluster);

    this.setupLangWatchEnv(
      domainParam,
      cluster,
      { redis, redisPassword },
      { postgres, postgresPassword },
      { elasticPassword }
    );

    setupFluentd(cluster);
    this.setupLangEvals(cluster);
    this.setupLangWatchNLP(cluster);
    this.setupLangWatch(domainParam, cluster);
  }

  private setupLangWatchEnv(
    domainParam: cdk.CfnParameter,
    cluster: eks.Cluster,
    {
      redis,
      redisPassword,
    }: {
      redis: elasticache.CfnReplicationGroup;
      redisPassword: secretsmanager.Secret;
    },
    {
      postgres,
      postgresPassword,
    }: {
      postgres: rds.DatabaseInstance;
      postgresPassword: secretsmanager.Secret;
    },
    {
      elasticPassword,
    }: {
      elasticPassword: secretsmanager.Secret;
    }
  ): secretsmanager.Secret {
    const generateSecureString = (name: string, length: number = 32) => {
      return new secretsmanager.Secret(this, `GeneratedSecret${name}`, {
        generateSecretString: {
          excludeCharacters: "'\"@/\\:?#[]&=+<>{}|^~`,%;",
          passwordLength: length,
        },
      }).secretValue
        .unsafeUnwrap()
        .toString();
    };

    const langwatchEnvSecret = new secretsmanager.Secret(
      this,
      "LangWatchEnvSecret",
      {
        secretObjectValue: {
          BASE_HOST: cdk.SecretValue.unsafePlainText(
            cdk.Fn.join("", ["https://", domainParam.valueAsString])
          ),
          NEXTAUTH_URL: cdk.SecretValue.unsafePlainText(
            cdk.Fn.join("", ["https://", domainParam.valueAsString])
          ),
          DEBUG: cdk.SecretValue.unsafePlainText("langwatch:*"),
          NEXTAUTH_PROVIDER: cdk.SecretValue.unsafePlainText("email"),
          NEXTAUTH_SECRET: cdk.SecretValue.unsafePlainText(
            generateSecureString("NextAuthSecret", 32)
          ),
          API_TOKEN_JWT_SECRET: cdk.SecretValue.unsafePlainText(
            generateSecureString("JWTSecret", 32)
          ),
          LANGWATCH_NLP_SERVICE: cdk.SecretValue.unsafePlainText(
            "http://langwatch-nlp-service:8080"
          ),
          LANGEVALS_ENDPOINT: cdk.SecretValue.unsafePlainText(
            "http://langevals-service:8000"
          ),
          REDIS_URL: cdk.SecretValue.unsafePlainText(
            cdk.Fn.join("", [
              "redis://:",
              redisPassword
                .secretValueFromJson("password")
                .unsafeUnwrap()
                .toString(),
              "@",
              redis.attrPrimaryEndPointAddress,
              ":",
              redis.attrPrimaryEndPointPort,
            ])
          ),
          DATABASE_URL: cdk.SecretValue.unsafePlainText(
            cdk.Fn.join("", [
              "postgresql://langwatch_db:",
              postgresPassword
                .secretValueFromJson("password")
                .unsafeUnwrap()
                .toString(),
              "@",
              postgres.dbInstanceEndpointAddress,
              ":",
              postgres.dbInstanceEndpointPort,
              "/langwatch_db?schema=public",
            ])
          ),
          ELASTICSEARCH_NODE_URL: cdk.SecretValue.unsafePlainText(
            cdk.Fn.join("", [
              "https://elastic:",
              elasticPassword.secretValue.unsafeUnwrap().toString(),
              "@elasticsearch-master:9200",
            ])
          ),
        },
      }
    );

    // Grant the EKS cluster permission to read the secret
    langwatchEnvSecret.grantRead(cluster.adminRole);

    // Create a ClusterRole
    const clusterRole = cluster.addManifest("CSIDriverClusterRole", {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRole",
      metadata: {
        name: "secrets-store-csi-driver-cluster-role",
      },
      rules: [
        {
          apiGroups: [""],
          resources: ["secrets"],
          verbs: ["get", "list", "watch", "create", "update", "delete"],
        },
        {
          apiGroups: [""],
          resources: ["namespaces"],
          verbs: ["get", "list", "watch"],
        },
      ],
    });

    // Create a ClusterRoleBinding
    const clusterRoleBinding = cluster.addManifest(
      "CSIDriverClusterRoleBinding",
      {
        apiVersion: "rbac.authorization.k8s.io/v1",
        kind: "ClusterRoleBinding",
        metadata: {
          name: "secrets-store-csi-driver-cluster-rolebinding",
        },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "ClusterRole",
          name: "secrets-store-csi-driver-cluster-role",
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: "secrets-store-csi-driver",
            namespace: "kube-system",
          },
        ],
      }
    );

    // Install Secrets Store CSI Driver and ASCP provider
    const csiDriver = cluster.addHelmChart("SecretsStoreCSIDriver", {
      chart: "secrets-store-csi-driver",
      repository:
        "https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts",
      namespace: "kube-system",
      release: "csi-secrets-store",
      values: {
        syncSecret: {
          enabled: true,
        },
      },
    });

    // Ensure the ClusterRole and ClusterRoleBinding are created after the Helm chart
    clusterRole.node.addDependency(csiDriver);
    clusterRoleBinding.node.addDependency(csiDriver);

    cluster.addHelmChart("ASCPProvider", {
      chart: "secrets-store-csi-driver-provider-aws",
      repository: "https://aws.github.io/secrets-store-csi-driver-provider-aws",
      namespace: "kube-system",
      release: "secrets-provider-aws",
    });

    // TODO: postgres password, redis password
    cluster.addManifest("LangWatchSecretProviderClass", {
      apiVersion: "secrets-store.csi.x-k8s.io/v1",
      kind: "SecretProviderClass",
      metadata: {
        name: "langwatch-secret-provider",
      },
      spec: {
        provider: "aws",
        secretObjects: [
          {
            secretName: "langwatch-k8s-secret",
            type: "Opaque",
            data: [
              {
                objectName: "BASE_HOST",
                key: "BASE_HOST",
              },
              {
                objectName: "NEXTAUTH_URL",
                key: "NEXTAUTH_URL",
              },
              {
                objectName: "DEBUG",
                key: "DEBUG",
              },
              {
                objectName: "NEXTAUTH_PROVIDER",
                key: "NEXTAUTH_PROVIDER",
              },
              {
                objectName: "NEXTAUTH_SECRET",
                key: "NEXTAUTH_SECRET",
              },
              {
                objectName: "LANGWATCH_NLP_SERVICE",
                key: "LANGWATCH_NLP_SERVICE",
              },
              {
                objectName: "LANGEVALS_ENDPOINT",
                key: "LANGEVALS_ENDPOINT",
              },
              {
                objectName: "REDIS_URL",
                key: "REDIS_URL",
              },
              {
                objectName: "DATABASE_URL",
                key: "DATABASE_URL",
              },
              {
                objectName: "ELASTICSEARCH_NODE_URL",
                key: "ELASTICSEARCH_NODE_URL",
              },
            ],
          },
        ],
        parameters: {
          objects: JSON.stringify([
            {
              objectName: langwatchEnvSecret.secretName,
              objectType: "secretsmanager",
              jmesPath: [
                {
                  path: "BASE_HOST",
                  objectAlias: "BASE_HOST",
                },
                {
                  path: "NEXTAUTH_URL",
                  objectAlias: "NEXTAUTH_URL",
                },
                {
                  path: "DEBUG",
                  objectAlias: "DEBUG",
                },
                {
                  path: "NEXTAUTH_PROVIDER",
                  objectAlias: "NEXTAUTH_PROVIDER",
                },
                {
                  path: "NEXTAUTH_SECRET",
                  objectAlias: "NEXTAUTH_SECRET",
                },
                {
                  path: "API_TOKEN_JWT_SECRET",
                  objectAlias: "API_TOKEN_JWT_SECRET",
                },
                {
                  path: "LANGWATCH_NLP_SERVICE",
                  objectAlias: "LANGWATCH_NLP_SERVICE",
                },
                {
                  path: "LANGEVALS_ENDPOINT",
                  objectAlias: "LANGEVALS_ENDPOINT",
                },
                {
                  path: "REDIS_URL",
                  objectAlias: "REDIS_URL",
                },
                {
                  path: "DATABASE_URL",
                  objectAlias: "DATABASE_URL",
                },
                {
                  path: "ELASTICSEARCH_NODE_URL",
                  objectAlias: "ELASTICSEARCH_NODE_URL",
                },
              ],
            },
          ]),
        },
      },
    });

    return langwatchEnvSecret;
  }

  setupRedis(vpc: ec2.Vpc, cluster: eks.Cluster) {
    const redisSecurityGroup = new ec2.SecurityGroup(
      this,
      "RedisSecurityGroup",
      { vpc }
    );

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "RedisSubnetGroup",
      {
        description: "Subnet group for Redis ElastiCache",
        subnetIds: vpc.privateSubnets.map((subnet) => subnet.subnetId),
      }
    );

    const redisPassword = new secretsmanager.Secret(this, "RedisPassword", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "redis" }),
        generateStringKey: "password",
        excludePunctuation: true,
        excludeCharacters: "'\"@/\\:?#[]&=+<>{}|^~`,%;",
        passwordLength: 16,
      },
    });

    const redis = new elasticache.CfnReplicationGroup(
      this,
      "RedisReplicationGroup",
      {
        replicationGroupDescription: "Redis cluster for LangWatch",
        replicationGroupId: "langwatch-redis",
        engine: "redis",
        engineVersion: "7.1",
        cacheParameterGroupName: "default.redis7",
        port: 6379,
        // cache.t4g.micro vCPU: 2, Memory: 0.5 GiB, Network Performance: Up to 5 Gigabit =>  13.14 USD/month (on-demand price for 1 instance)
        cacheNodeType: "cache.t4g.micro",
        numNodeGroups: 1,
        replicasPerNodeGroup: 1,
        cacheSubnetGroupName: redisSubnetGroup.ref,
        securityGroupIds: [redisSecurityGroup.securityGroupId],
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: true,
        authToken: redisPassword
          .secretValueFromJson("password")
          .unsafeUnwrap()
          .toString(),
        multiAzEnabled: true, // Enable Multi-AZ (automatic failover)
      }
    );

    const addIngressRule = new cr.AwsCustomResource(
      this,
      "AddRedisIngressRule",
      {
        onUpdate: {
          service: "EC2",
          action: "authorizeSecurityGroupIngress",
          parameters: {
            GroupId: redisSecurityGroup.securityGroupId,
            IpPermissions: [
              {
                IpProtocol: "tcp",
                FromPort: 6379,
                ToPort: 6379,
                UserIdGroupPairs: [
                  {
                    GroupId: cluster.clusterSecurityGroupId,
                  },
                ],
              },
            ],
          },
          physicalResourceId: cr.PhysicalResourceId.of("RedisIngressRule"),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      }
    );

    // Ensure this runs after both Redis and EKS are created
    addIngressRule.node.addDependency(redis);
    addIngressRule.node.addDependency(cluster);

    return { redis, redisPassword };
  }

  setupPostgres(vpc: ec2.Vpc, cluster: eks.Cluster) {
    const postgresSecurityGroup = new ec2.SecurityGroup(
      this,
      "PostgresSecurityGroup",
      { vpc }
    );

    const postgresPassword = new secretsmanager.Secret(
      this,
      "PostgresPassword",
      {
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "langwatch_db" }),
          generateStringKey: "password",
          excludePunctuation: true,
          excludeCharacters: "\"'@/\\:?#[]&=+<>{}|^~`,%;",
          passwordLength: 16,
        },
      }
    );

    const postgres = new rds.DatabaseInstance(this, "PostgresInstance", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [postgresSecurityGroup],
      databaseName: "langwatch_db",
      deletionProtection: false, // Set to true for production
      credentials: rds.Credentials.fromSecret(postgresPassword),
      backupRetention: cdk.Duration.days(7),
      preferredBackupWindow: "00:00-04:00",
      storageEncrypted: true,
    });

    const addPostgresIngressRule = new cr.AwsCustomResource(
      this,
      "AddPostgresIngressRule",
      {
        onUpdate: {
          service: "EC2",
          action: "authorizeSecurityGroupIngress",
          parameters: {
            GroupId: postgresSecurityGroup.securityGroupId,
            IpPermissions: [
              {
                IpProtocol: "tcp",
                FromPort: 5432,
                ToPort: 5432,
                UserIdGroupPairs: [
                  {
                    GroupId: cluster.clusterSecurityGroupId,
                  },
                ],
              },
            ],
          },
          physicalResourceId: cr.PhysicalResourceId.of("PostgresIngressRule"),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      }
    );

    // Ensure this runs after both PostgreSQL and EKS are created
    addPostgresIngressRule.node.addDependency(postgres);
    addPostgresIngressRule.node.addDependency(cluster);

    return { postgres, postgresPassword };
  }

  setupElasticsearch(vpc: ec2.Vpc, cluster: eks.Cluster) {
    const elasticPassword = new secretsmanager.Secret(
      this,
      "ElasticsearchPassword",
      {
        generateSecretString: {
          excludeCharacters: "'\"@/\\:?#[]&=+<>{}|^~`,%;",
          passwordLength: 32,
        },
      }
    );

    new eks.HelmChart(this, "ElasticsearchChart", {
      cluster,
      chart: "elasticsearch",
      repository: "https://helm.elastic.co",
      namespace: "elasticsearch",
      release: "elasticsearch",
      values: {
        antiAffinity: "soft",
        esJavaOpts: "-Xmx2g -Xms2g",
        resources: {
          requests: {
            cpu: "500m",
            memory: "2Gi",
          },
          limits: {
            cpu: "1000m",
            memory: "4Gi",
          },
        },
        volumeClaimTemplate: {
          accessModes: ["ReadWriteOnce"],
          resources: {
            requests: {
              storage: "5Gi",
            },
          },
        },
        security: {
          enabled: true,
          password: elasticPassword.secretValue.unsafeUnwrap().toString(),
        },
      },
      timeout: cdk.Duration.minutes(15),
    });

    return { elasticPassword };
  }

  setupLangEvals(cluster: eks.Cluster) {
    // Add a Kubernetes manifest for the langevals service
    cluster.addManifest("langevals", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "langevals",
        annotations: {
          "deployment-timestamp": new Date().toISOString(),
        },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "langevals" } },
        template: {
          metadata: { labels: { app: "langevals" } },
          spec: {
            containers: [
              {
                name: "langevals",
                image: `339712859611.dkr.ecr.eu-central-1.amazonaws.com/onprem_langevals:${langWatchPackageJson.version}`,
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
      metadata: {
        name: "langevals-service",
        annotations: {
          "deployment-timestamp": new Date().toISOString(),
        },
      },
      spec: {
        selector: { app: "langevals" },
        ports: [{ port: 80, targetPort: 8000 }],
        type: "ClusterIP",
      },
    });
  }

  setupLangWatchNLP(cluster: eks.Cluster) {
    cluster.addManifest("langwatch-nlp", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "langwatch-nlp",
        annotations: {
          "deployment-timestamp": new Date().toISOString(),
        },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "langwatch-nlp" } },
        template: {
          metadata: { labels: { app: "langwatch-nlp" } },
          spec: {
            containers: [
              {
                name: "langwatch-nlp",
                image: `339712859611.dkr.ecr.eu-central-1.amazonaws.com/onprem_langwatch_nlp:${langWatchPackageJson.version}`,
                ports: [{ containerPort: 8080 }],
              },
            ],
          },
        },
      },
    });

    cluster.addManifest("langwatch-nlp-service", {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "langwatch-nlp-service",
        annotations: {
          "deployment-timestamp": new Date().toISOString(),
        },
      },
      spec: {
        selector: { app: "langwatch-nlp" },
        ports: [{ port: 80, targetPort: 8080 }],
        type: "ClusterIP",
      },
    });
  }

  setupLangWatch(domainParam: cdk.CfnParameter, cluster: eks.Cluster) {
    const langwatchServiceAccount = cluster.addServiceAccount("langwatch-sa", {
      name: "langwatch-sa",
    });

    langwatchServiceAccount.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecrets",
        ],
        resources: ["arn:aws:secretsmanager:*:*:secret:*"],
      })
    );

    cluster.addManifest("langwatch", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "langwatch",
        annotations: {
          "deployment-timestamp": new Date().toISOString(),
        },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "langwatch" } },
        template: {
          metadata: { labels: { app: "langwatch" } },
          spec: {
            serviceAccountName: "langwatch-sa",
            containers: [
              {
                name: "langwatch",
                image: `339712859611.dkr.ecr.eu-central-1.amazonaws.com/onprem_langwatch_saas:${langWatchPackageJson.version}`,
                ports: [{ containerPort: 3000 }],
                envFrom: [
                  {
                    secretRef: {
                      name: "langwatch-k8s-secret",
                    },
                  },
                ],
                volumeMounts: [
                  {
                    name: "langwatch-secrets",
                    mountPath: "/mnt/secrets-store",
                    readOnly: true,
                  },
                ],
              },
            ],
            volumes: [
              {
                name: "langwatch-secrets",
                csi: {
                  driver: "secrets-store.csi.k8s.io",
                  readOnly: true,
                  volumeAttributes: {
                    secretProviderClass: "langwatch-secret-provider",
                  },
                },
              },
            ],
          },
        },
      },
    });

    cluster.addManifest("langwatch-service", {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "langwatch-service",
        annotations: {
          "deployment-timestamp": new Date().toISOString(),
        },
      },
      spec: {
        selector: { app: "langwatch" },
        ports: [{ port: 80, targetPort: 3000 }],
        type: "LoadBalancer",
      },
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, "LangWatchLoadBalancerDNS", {
      value: cluster.getServiceLoadBalancerAddress("langwatch-service", {
        timeout: cdk.Duration.minutes(15),
      }),
      description:
        "Application Load Balancer DNS Name. Point your subdomain CNAME record to this value.",
    });
  }
}
