# LangWatch Helm Chart

This Helm chart deploys LangWatch, an AI observability platform, on Kubernetes.

## Installation

When installing this chart, the following values must be provided:

- `app.env.NEXTAUTH_SECRET`: A random string used to hash tokens, sign cookies and generate cryptographic keys. If not provided, authentication will fail.
- `app.env.API_TOKEN_JWT_SECRET`: A random string to store provided API tokens.
- `app.env.BASE_HOST`: The base URL of the application.
- `app.env.NEXTAUTH_URL`: The URL of the authentication service.
- `app.env.CRON_API_KEY`: API key for cronjob authentication (required if cronjobs are enabled).
- `app.env.METRICS_API_KEY`: API key for metrics authentication (required if monitoring is enabled).

### Basic Installation (Without Monitoring)

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

### Installation with Monitoring

For monitoring setup, you'll need to add the `metricsApiKey`:

```bash
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export API_TOKEN_JWT_SECRET=$(openssl rand -base64 32)
export CRON_API_KEY=$(openssl rand -base64 32)
export METRICS_API_KEY=$(openssl rand -base64 32)  # ← Additional for monitoring
export BASE_HOST="http://localhost:5560" # or yourdomain.com
export NEXTAUTH_URL="http://localhost:5560" # or yourdomain.com

# Install LangWatch with monitoring enabled
helm install langwatch ./langwatch \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.BASE_HOST=$BASE_HOST \
  --set app.env.NEXTAUTH_URL=$NEXTAUTH_URL \
  --set app.env.CRON_API_KEY=$CRON_API_KEY \
  --set app.env.METRICS_API_KEY=$METRICS_API_KEY \
  --set global.monitoring.enabled=true \
  --set prometheus.enabled=true
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

## Monitoring

LangWatch includes integrated Prometheus monitoring for observability. The monitoring is built into the main LangWatch chart and can be enabled with a simple configuration.

### Quick Setup

```bash
# Generate all required secrets including metrics key
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export API_TOKEN_JWT_SECRET=$(openssl rand -base64 32)
export CRON_API_KEY=$(openssl rand -base64 32)
export METRICS_API_KEY=$(openssl rand -base64 32)  # ← Required for monitoring

# Deploy LangWatch with monitoring enabled
helm install langwatch ./langwatch \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.BASE_HOST="http://localhost:5560" \
  --set app.env.NEXTAUTH_URL="http://localhost:5560" \
  --set app.env.CRON_API_KEY=$CRON_API_KEY \
  --set app.env.METRICS_API_KEY=$METRICS_API_KEY \
  --set global.monitoring.enabled=true \
  --set prometheus.enabled=true
```

### Access Prometheus

```bash
# Port forward for development
kubectl port-forward svc/langwatch-prometheus 9090:9090
```

Access Prometheus at: http://localhost:9090

### What Gets Monitored

- **LangWatch App**: Main application metrics (port 5560)
- **LangWatch Workers**: Worker metrics (port 2999)
- **Kubernetes Infrastructure**: Node and container metrics via cAdvisor

### Prometheus Configuration

The Prometheus configuration can be customized through the `prometheus` section in values.yaml:

```yaml
prometheus:
  enabled: false # Set to true to enable
  image:
    repository: quay.io/prometheus/prometheus
    tag: "v3.0.1"
  service:
    type: ClusterIP # Change to LoadBalancer for external access
    port: 9090
  storage:
    enabled: true
    size: 6Gi
    storageClass: "" # Use default storage class
  retention: 60d
  rbac:
    enabled: true
```

### LangWatch Pod Annotations

For Prometheus to discover your LangWatch pods, ensure they have the correct annotations:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "5560" # For main app
    prometheus.io/path: "/metrics" # For workers with custom paths
```
