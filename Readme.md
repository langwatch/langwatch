# Connection to Production RDS

1. Install SSM [Session Manager plugin]
2. Run the following cli command in a terminal and keep it open (this will create a session with the bastion ec2 instance and port forward to the rds instance)

```shell
aws ssm start-session --region eu-central-1 --target i-00a6de26faec3abcd  --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host="langwatch-mysql.cfu2ksege2c2.eu-central-1.rds.amazonaws.com",portNumber="3306",localPortNumber="3306"  --profile lw-prod
```


[Session Manager plugin]: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html