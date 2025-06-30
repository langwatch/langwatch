## Installation

When installing this chart, the following values must be provided:

- `app.env.NEXTAUTH_SECRET`: A random string used to hash tokens, sign cookies and generate cryptographic keys. If not provided, authentication will fail.
- `app.env.API_TOKEN_JWT_SECRET`: A random string to store provided API tokens.
- `app.env.BASE_HOST`: The base URL of the application.
- `app.env.NEXTAUTH_URL`: The URL of the authentication service.
- `app.env.CRON_API_KEY`: API key for cronjob authentication (required if cronjobs are enabled).

Example:

```bash
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export API_TOKEN_JWT_SECRET=$(openssl rand -base64 32)
export CRON_API_KEY=$(openssl rand -base64 32)
export BASE_HOST="http://localhost:5560" # or yourdomain.com
export NEXTAUTH_URL="http://localhost:5560" # or yourdomain.com

helm install langwatch ./langwatch \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.BASE_HOST=$BASE_HOST \
  --set app.env.NEXTAUTH_URL=$NEXTAUTH_URL \
  --set app.env.CRON_API_KEY=$CRON_API_KEY
```

## CronJobs

This chart includes several cronjobs for periodic tasks:

- **Topic Clustering**: Runs daily at midnight (`0 0 * * *`)
- **Alert Triggers**: Runs every 3 minutes (`*/3 * * * *`)
- **Traces Retention Cleanup**: Runs daily at 1 AM (`0 1 * * *`)

CronJobs can be disabled globally by setting `cronjobs.enabled=false` or individually by setting `cronjobs.jobs.<jobName>.enabled=false`.

Examples:
```bash
# Disable all cronjobs
helm install langwatch ./langwatch --set cronjobs.enabled=false

# Disable specific cronjobs
helm install langwatch ./langwatch --set cronjobs.jobs.alertTriggers.enabled=false
```
