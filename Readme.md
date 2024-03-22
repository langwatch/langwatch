# Setting up the project locally

1. Find the .env file on 1password and copy it here

2. Clone the git submodules `git submodule update --init`

3. Run `node -v` and make sure you have NodeJS v20 installed (use nvm to manage versions)

4. `npm install`

5. `npm run start:prepare`

6. `npm run dev`

# Connection to Production MySQL and Redis

1. Install AWS cli and setup `~/.aws/credentials` file
2. Install SSM [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
3. Run the following cli command in a terminal and keep it open for MySQL (this will create a session with the bastion ec2 instance and port forward to the rds instance)

```shell
aws ssm start-session --region eu-central-1 --target i-00a6de26faec3abcd --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host="langwatch-mysql.cfu2ksege2c2.eu-central-1.rds.amazonaws.com",portNumber="3306",localPortNumber="3306"  --profile lw-prod
```

4. Run the following one for redis:

```shell
aws ssm start-session --region eu-central-1 --target i-00a6de26faec3abcd  --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host="master.langwatch-redis-replication-group.ulyeig.euc1.cache.amazonaws.com",portNumber="6379",localPortNumber="6379"  --profile lw-prod
```
