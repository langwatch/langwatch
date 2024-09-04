import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";
import langWatchPackageJson from "../../../package.json";

interface LangWatchNLPStackProps extends cdk.StackProps {
  cluster: eks.Cluster;
}

export class LangWatchNLPStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LangWatchNLPStackProps) {
    super(scope, id, props);

    const { cluster } = props;

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
}
