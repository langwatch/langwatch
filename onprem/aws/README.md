# LangWatch AWS Marketplace - OnPrem CDK

To install cdk:

```
npm -g install aws-cdk
```

To synthesize the CloudFormation template:

```
cdk synth
```

To deploy it for a certain profile:

```
cdk deploy --profile sf-dev --no-rollback
```

# Roles and Debugging

When deploying, AWS Marketplace uses the AWSServiceRoleForMarketplaceDeployment role, this is the role we use as well that should have permission to all deployments. If set up through Marketplace QuickLaunch, then this role should be created automatically, if not, use this guide: https://docs.aws.amazon.com/IAM/latest/UserGuide/using-service-linked-roles.html#create-service-linked-role and choose AWS Marketplace - Deployment Management for the Use Case when creating.

The full ARN will be this:

arn:aws:iam::123456789012:role/aws-service-role/deployment.marketplace.amazonaws.com/AWSServiceRoleForMarketplaceDeployment

With the Account ID being the role you are deploying to (sf-dev on our local tests).

We then also give permission (like the see the kubernetes pods) to the OrganizationAccountAccessRole role, for being able to debug the resources.

# Kubernetes CLI

Set up kubectl to point to the AWS EKS cluster:

```
aws eks --profile sf-dev --region eu-central-1 update-kubeconfig --name LangWatchCluster914B7009-03da053b2b9b44caba6ad56f4413c84c
```

Then

```
kubectl get all
```

Have fun!


## Other useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
