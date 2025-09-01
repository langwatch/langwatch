# LangWatch Helm Chart

This Helm chart deploys LangWatch, an AI observability platform, on Kubernetes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Required Secrets](#required-secrets)
  - [Creating Custom Values Files](#creating-custom-values-files)
  - [Using Production Values](#using-production-values)
  - [External Services](#external-services)
  - [SSO Configuration](#sso-configuration)
  - [Monitoring](#monitoring)
- [Advanced Configuration](#advanced-configuration)
  - [CronJobs](#cronjobs)
  - [Ingress](#ingress)
  - [Resource Management](#resource-management)
- [Troubleshooting](#troubleshooting)
- [Migration Guide](#migration-guide)

## Prerequisites

- Kubernetes cluster (1.20+)
- Helm 3.0+
- kubectl configured to access your cluster

## Quick Start

### 1. Generate Required Secrets

```bash
# Generate secure random secrets
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export API_TOKEN_JWT_SECRET=$(openssl rand -base64 32)
export CRON_API_KEY=$(openssl rand -base64 32)
```

### 2. Install LangWatch

```bash
helm install langwatch ./langwatch \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY \
  --set app.env.BASE_HOST="http://localhost:5560" \
  --set app.env.NEXTAUTH_URL="http://localhost:5560"
```

> **TIP**
> 
> You can also use a values file to avoid long command lines:
> 
> ```bash
> # Create a quick-start values file
> cat > quick-start.yaml << EOF
> app:
>   env:
>     NEXTAUTH_SECRET: $NEXTAUTH_SECRET
>     API_TOKEN_JWT_SECRET: $API_TOKEN_JWT_SECRET
>     CRON_API_KEY: $CRON_API_KEY
>     BASE_HOST: "http://localhost:5560"
>     NEXTAUTH_URL: "http://localhost:5560"
> EOF
> 
> # Install using the values file
> helm install langwatch ./langwatch -f quick-start.yaml
> ```

### 3. Access the Application

```bash
# Port forward to access the application
kubectl port-forward svc/langwatch-app 5560:5560
```

Access LangWatch at: http://localhost:5560

> **WARNING**
> 
> The default installation includes built-in PostgreSQL and Redis. For production deployments, consider using external managed services for better reliability and performance.

## Configuration

### Required Secrets

LangWatch requires three essential secrets for secure operation:

| Secret | Description | Generation |
|--------|-------------|------------|
| `NEXTAUTH_SECRET` | Used for token hashing and session encryption | `openssl rand -base64 32` |
| `API_TOKEN_JWT_SECRET` | Used for API token signing and verification | `openssl rand -base64 32` |
| `CRON_API_KEY` | Used for cronjob authentication | `openssl rand -base64 32` |

**Optional for monitoring:**
- `METRICS_API_KEY` - For metrics authentication (generate with `openssl rand -base64 32`)

### Creating Custom Values Files

Create a custom values file to override default configurations:

```bash
# Create your custom values file
cat > my-values.yaml << EOF
# Custom values for LangWatch deployment
global:
  env: production
  monitoring:
    enabled: true

app:
  replicaCount: 2
  resources:
    requests:
      cpu: 200m
      memory: 1Gi
    limits:
      cpu: 1000m
      memory: 2Gi
  env:
    BASE_HOST: "https://yourdomain.com"
    NEXTAUTH_URL: "https://yourdomain.com"
    # External database
    DATABASE_URL: "postgresql://user:password@your-managed-postgres:5432/langwatch?sslmode=require"
    # External Redis
    REDIS_URL: "redis://:password@your-managed-redis:6379/0"

# Disable built-in services when using external ones
postgres:
  enabled: false

redis:
  enabled: false

# Enable monitoring
prometheus:
  enabled: true
  storage:
    size: 10Gi
EOF
```

### Using Production Values

The chart includes a production-ready values file. Here's how to use it:

#### Deployment Scenarios

**Local Development (from chart directory):**
If you're working directly in the `charts/langwatch` directory:
```bash
helm install langwatch . -f values-production.example.yaml \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY \
  --set app.env.METRICS_API_KEY=$METRICS_API_KEY
```

**From Repository Root:**
If you're in the repository root directory (recommended):
```bash
helm install langwatch ./charts/langwatch -f charts/langwatch/values-production.example.yaml \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY \
  --set app.env.METRICS_API_KEY=$METRICS_API_KEY
```

**From Helm Repository:**
If you've added this chart to a Helm repository:
```bash
helm install langwatch langwatch/langwatch -f values-production.yaml \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY \
  --set app.env.METRICS_API_KEY=$METRICS_API_KEY
```

#### Step 1: Create Production Values File

Since you may not have cloned this repository, create your production values file based on the example below:

```bash
# Create your production values file
vim values-production.yaml
```

#### Step 2: Use the Production Values Template

Copy the following production-ready configuration into your `values-production.yaml` file. You can use the [values-production.example.yaml](values-production.example.yaml) as a template to build from.

**Note:** This configuration completely replaces the default values. You don't need to merge it with `values.yaml` - Helm will automatically handle the merging when you use the `-f` flag.

#### Step 3: Deploy with Production Values

```bash
# Generate secrets
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export API_TOKEN_JWT_SECRET=$(openssl rand -base64 32)
export CRON_API_KEY=$(openssl rand -base64 32)
export METRICS_API_KEY=$(openssl rand -base64 32)

# Deploy with production values and secrets
helm install langwatch ./langwatch -f values-production.example.yaml \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY \
  --set app.env.METRICS_API_KEY=$METRICS_API_KEY
```

### External Services

#### Use External PostgreSQL

```bash
helm install langwatch ./langwatch \
  --set postgres.enabled=false \
  --set app.env.DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require" \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY
```

#### Use External Redis

```bash
helm install langwatch ./langwatch \
  --set redis.enabled=false \
  --set app.env.REDIS_URL="redis://:password@host:6379/0" \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY
```

#### Use Both External Services

```bash
helm install langwatch ./langwatch \
  --set postgres.enabled=false \
  --set redis.enabled=false \
  --set app.env.DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require" \
  --set app.env.REDIS_URL="redis://:password@host:6379/0" \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY
```

### SSO Configuration

#### Azure AD Setup

```bash
helm install langwatch ./langwatch \
  --set app.env.AZURE_AD_CLIENT_ID="your-client-id" \
  --set app.env.AZURE_AD_CLIENT_SECRET="your-client-secret" \
  --set app.env.NEXTAUTH_PROVIDERS='[{"id":"azure-ad","name":"Azure AD","type":"oauth","clientId":"your-client-id","clientSecret":"your-client-secret","wellKnown":"https://login.microsoftonline.com/your-tenant-id/v2.0/.well-known/openid_configuration"}]' \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY
```

### Monitoring

Enable Prometheus monitoring for observability:

```bash
# Generate metrics API key
export METRICS_API_KEY=$(openssl rand -base64 32)

# Deploy with monitoring enabled
helm install langwatch ./langwatch \
  --set global.monitoring.enabled=true \
  --set prometheus.enabled=true \
  --set app.env.METRICS_API_KEY=$METRICS_API_KEY \
  --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set app.env.CRON_API_KEY=$CRON_API_KEY
```

#### Access Prometheus

```bash
# Port forward Prometheus
kubectl port-forward svc/langwatch-prometheus 9090:9090
```

Access Prometheus at: http://localhost:9090

## Advanced Configuration

### CronJobs

LangWatch includes several cronjobs for periodic tasks:

| Job | Schedule | Purpose |
|-----|----------|---------|
| `topicClustering` | `0 0 * * *` (daily at midnight) | Clusters conversation topics |
| `alertTriggers` | `*/3 * * * *` (every 3 minutes) | Processes alert triggers |
| `tracesRetentionCleanup` | `0 1 * * *` (daily at 1 AM) | Cleans up old traces |

#### Disable All CronJobs

```bash
helm install langwatch ./langwatch \
  --set cronjobs.enabled=false \
  # ... other settings
```

#### Disable Specific CronJobs

```bash
helm install langwatch ./langwatch \
  --set cronjobs.jobs.alertTriggers.enabled=false \
  --set cronjobs.jobs.topicClustering.enabled=false \
  # ... other settings
```

#### Customize CronJob Schedules

```yaml
# In your values file
cronjobs:
  enabled: true
  jobs:
    topicClustering:
      schedule: "0 2 * * *"  # Run at 2 AM instead of midnight
    alertTriggers:
      schedule: "*/5 * * * *"  # Run every 5 minutes instead of 3
    tracesRetentionCleanup:
      schedule: "0 3 * * *"  # Run at 3 AM instead of 1 AM
```

### Ingress

Enable and configure ingress for external access:

```yaml
# In your values file
ingress:
  enabled: true
  className: "nginx"  # or your ingress controller
  hosts:
    - host: langwatch.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: langwatch-app
                port:
                  number: 5560
  tls:
    - secretName: langwatch-tls
      hosts:
        - langwatch.yourdomain.com
```

### Resource Management

Customize resource requests and limits:

```yaml
# In your values file
app:
  resources:
    requests:
      cpu: 200m
      memory: 1Gi
    limits:
      cpu: 1000m
      memory: 2Gi

langwatch_nlp:
  resources:
    requests:
      cpu: 500m
      memory: 1024Mi
    limits:
      cpu: 1000m
      memory: 2048Mi

langevals:
  resources:
    requests:
      cpu: 500m
      memory: 4096Mi
    limits:
      cpu: 1000m
      memory: 6144Mi
```

## Troubleshooting

### Common Issues

#### External Database Connection Issues

1. **Verify connection string format**:
   ```bash
   # Correct format
   postgresql://username:password@host:port/database?schema=public&sslmode=require
   ```

2. **Test connectivity**:
   ```bash
   kubectl run test-db --rm -i --tty --image=postgres:16 -- \
     psql "postgresql://username:password@your-managed-postgres:5432/database"
   ```

#### External Redis Connection Issues

1. **Verify Redis URL format**:
   ```bash
   # Standard format
   redis://host:port
   redis://:password@host:port
   redis://host:port/0
   ```

2. **Test connectivity**:
   ```bash
   kubectl run test-redis --rm -i --tty --image=redis:alpine -- \
     redis-cli -h your-managed-redis -p 6379 ping
   ```

#### SSO Configuration Issues

1. **Verify provider configuration**:
   ```bash
   # Check JSON format
   echo 'your-nexauth-providers-json' | jq .
   ```

2. **Check redirect URIs**:
   - Ensure redirect URI matches your `NEXTAUTH_URL`
   - Format: `https://yourdomain.com/api/auth/callback/azure-ad`

### Debug Commands

```bash
# Check application logs
kubectl logs -f deployment/langwatch-app

# Check environment variables
kubectl exec -it deployment/langwatch-app -- env | grep -E "(DATABASE_URL|REDIS_URL|NEXTAUTH)"

# Check pod status
kubectl get pods -l app.kubernetes.io/name=langwatch

# Check services
kubectl get svc -l app.kubernetes.io/name=langwatch

# Check Helm release status
helm status langwatch

# List all resources created by the chart
helm get manifest langwatch

# Check for any failed resources
kubectl get all -l app.kubernetes.io/instance=langwatch
```

## Upgrading and Maintenance

### Upgrading LangWatch

```bash
# Update the Helm repository (if using a repo)
helm repo update

# Upgrade the release
helm upgrade langwatch ./langwatch -f your-values.yaml

# Check the upgrade status
helm status langwatch
kubectl get pods -l app.kubernetes.io/instance=langwatch
```

### Uninstalling LangWatch

```bash
# Uninstall the Helm release
helm uninstall langwatch

# Remove persistent volumes (WARNING: This will delete all data!)
kubectl delete pvc -l app.kubernetes.io/instance=langwatch

# Remove any remaining resources
kubectl delete all -l app.kubernetes.io/instance=langwatch
```

> **WARNING**
> 
> Uninstalling will remove all LangWatch data unless you're using external databases. Make sure to backup your data before uninstalling.

### Rolling Back

```bash
# List previous revisions
helm history langwatch

# Rollback to a previous revision
helm rollback langwatch <revision-number>

# Check rollback status
helm status langwatch
```

## Migration Guide

### From Built-in to External Services

1. **Backup your data**:
   ```bash
   # Backup PostgreSQL data
   kubectl exec -it langwatch-postgres-0 -- pg_dump -U prisma mydb > backup.sql
   ```

2. **Update your values**:
   ```yaml
   # Disable built-in services
   postgres:
     enabled: false
   redis:
     enabled: false
   
   # Add external service URLs
   app:
     env:
       DATABASE_URL: "postgresql://user:pass@external-host:5432/db"
       REDIS_URL: "redis://external-host:6379"
   ```

3. **Upgrade the deployment**:
   ```bash
   helm upgrade langwatch ./langwatch -f your-values.yaml
   ```

4. **Verify the migration**:
   ```bash
   kubectl logs -f deployment/langwatch-app
   kubectl exec -it deployment/langwatch-app -- env | grep DATABASE_URL
   ```

### Best Practices

#### Security
- Never commit secrets to version control
- Use Kubernetes secrets or external secret management
- Rotate secrets regularly
- Use least-privilege access for database users
- Enable RBAC and network policies

#### Performance
- Use connection pooling for external databases
- Configure appropriate resource limits
- Monitor resource usage with Prometheus
- Use managed services for production workloads
- Scale horizontally for high availability

#### Monitoring
- Enable Prometheus monitoring for observability
- Set up alerts for critical metrics
- Monitor database connection pools
- Track application performance metrics
- Use Grafana dashboards for visualization

#### Backup and Recovery
- Set up automated backups for PostgreSQL data
- Test restore procedures regularly
- Store backups in multiple locations
- Document disaster recovery procedures

## Quick Reference

### Common Commands

```bash
# Install
helm install langwatch ./langwatch -f values.yaml

# Upgrade
helm upgrade langwatch ./langwatch -f values.yaml

# Uninstall
helm uninstall langwatch

# Check status
helm status langwatch

# View logs
kubectl logs -f deployment/langwatch-app

# Port forward
kubectl port-forward svc/langwatch-app 5560:5560
```

### Default Ports

| Service | Port | Description |
|---------|------|-------------|
| LangWatch App | 5560 | Main application |
| PostgreSQL | 5432 | Database (if enabled) |
| Redis | 6379 | Cache (if enabled) |
| Prometheus | 9090 | Metrics (if enabled) |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_SECRET` | Yes | Session encryption |
| `API_TOKEN_JWT_SECRET` | Yes | API token signing |
| `CRON_API_KEY` | Yes | Cronjob authentication |
| `DATABASE_URL` | No* | PostgreSQL connection |
| `REDIS_URL` | No* | Redis connection |
| `BASE_HOST` | Yes | Application URL |
| `NEXTAUTH_URL` | Yes | Auth callback URL |

*Required if using external services
