import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";
import langWatchPackageJson from "../../../package.json";

interface LangEvalsStackProps extends cdk.StackProps {
  cluster: eks.Cluster;
}

export class LangEvalsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LangEvalsStackProps) {
    super(scope, id, props);

    const { cluster } = props;

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
}
