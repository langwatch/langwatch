This is the private SaaS version of LangWatch protected by copyright. No copy, modification or reuse without permission is allowed.

## LangWatch SaaS

# Setting up the project locally

1. Find the .env file on 1password and copy it here

2. Install redis and start it up:

    ```
    brew install redis
    brew services start redis
    ```

3. Clone the git submodules `git submodule update --init`

4. Run `node -v` and make sure you have NodeJS v20 installed (use nvm to manage versions)

5. `npm install`

6. `npm run start:prepare`

7. `npm run dev`

# Connection to Production MySQL and Redis

1. Install AWS cli and setup `~/.aws/credentials` file
2. Install SSM [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
3. Run the following cli command in a terminal and keep it open for MySQL (this will create a session with the bastion ec2 instance and port forward to the rds instance)

```shell
aws ssm start-session --region eu-central-1 --target i-00a6de26faec3abcd --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host="langwatch-pg.cfu2ksege2c2.eu-central-1.rds.amazonaws.com",portNumber="5432",localPortNumber="5432" --profile lw-prod
```

4. Run the following one for redis (we use port 6378 localy to not conflict with the locally running redis):

```shell
aws ssm start-session --region eu-central-1 --target i-00a6de26faec3abcd  --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host="master.langwatch-redis-replication-group.ulyeig.euc1.cache.amazonaws.com",portNumber="6379",localPortNumber="6378"  --profile lw-prod
```

# Cloud Infrastructure

The cloud infrastructure is managed by Terraform, and it lives on the `/infrastructure` directory.
Docker images are built automatically and deployed on new pushes to main for this repository.

# On Prem Installation

The on prem templates for the marketplaces are located in the `/onprem` directory.

The docker images used by them are built with a github action when a new github release is made with a tag starting with `onprem-`, using the version from the top-level `package.json`, and pushed to a private repository in the clouds. Except langevals, which is fetched from the
public docker hub.

For AWS, we use CDK for generating the CloudFormation template and deploying, check out the README inside that folder for more details.
