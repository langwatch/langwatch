# LangWatch Helm Chart

A Helm chart for deploying LangWatch, an AI observability platform, on Kubernetes.

## Quick Start

### Development Mode (Recommended for Local Testing)

For local development and testing, use the included development values:

```bash
# Install with development values (auto-generated secrets, reduced resources)
helm install langwatch ./langwatch -f values.dev.yaml
```

This will:
- ✅ Auto-generate all required secrets
- ✅ Use built-in PostgreSQL, Redis, and OpenSearch
- ✅ Configure sensible resource limits for development
- ✅ Set up port 5560 for access

### Production Mode

For production deployments, you must provide your own secrets:

```bash
# Generate secure secrets
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export API_TOKEN_JWT_SECRET=$(openssl rand -base64 32)
export CRON_API_KEY=$(openssl rand -base64 32)
export METRICS_API_KEY=$(openssl rand -base64 32)

# Create Kubernetes secret
kubectl create secret generic langwatch-secrets \
  --from-literal=NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
  --from-literal=API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET \
  --set CRON_API_KEY=$CRON_API_KEY \
  --set METRICS_API_KEY=$METRICS_API_KEY

# Install with production configuration
helm install langwatch ./langwatch \
  --set secrets.existingSecret=langwatch-secrets \
  --set app.env.BASE_HOST="https://your-domain.com" \
  --set app.env.NEXTAUTH_URL="https://your-domain.com"
```

## Access Your Application

After installation, access LangWatch via port forwarding:

```bash
# Port forward to access the application
kubectl port-forward svc/langwatch-app 5560:5560
```

Then open your browser to: **http://localhost:5560**

## Configuration

### Using Custom Values Files

The recommended approach is to create custom values files and use the `-f` flag:

```bash
# Create your custom values
cat > my-values.yaml << EOF
app:
  replicaCount: 2
  env:
    BASE_HOST: "https://myapp.com"
    NEXTAUTH_URL: "https://myapp.com"
  resources:
    limits:
      memory: 8Gi

postgresql:
  auth:
    password: "my-secure-password"
EOF

# Install using your custom values
helm install langwatch ./langwatch -f my-values.yaml
```

You can combine multiple values files:

```bash
# Use development base + your custom overrides
helm install langwatch ./langwatch -f values.dev.yaml -f my-values.yaml
```

### Sensible Defaults

The chart provides sensible defaults for most use cases:

- **Resources**: Appropriate CPU/memory limits for each service
- **Persistence**: 20Gi for PostgreSQL, 10Gi for Redis, 20Gi for OpenSearch
- **Security**: Non-root containers, read-only filesystems, dropped capabilities
- **Monitoring**: Prometheus integration available but disabled by default

### Auto-Generation Mode (Development Only)

<Warning>
**Auto-generation only works for development environments and does NOT work for PostgreSQL passwords.**
</Warning>

When `autogen.enabled: true` (as in `values.dev.yaml`):
- ✅ API tokens and secrets are auto-generated
- ✅ Redis and OpenSearch passwords are auto-generated
- ❌ **PostgreSQL password must be manually set**

For development, you can set a simple PostgreSQL password:

```yaml
# In your values file
postgresql:
  auth:
    password: "dev-password-123"
```

### Complete Development Values File

<details>

<summary>View full values.dev.yaml contents</summary>

```yaml
# Minimal development values for LangWatch Helm chart
# Only essential overrides for development environment

# Enable auto-generation of secrets for development
autogen:
  enabled: true

# Use built-in services for simplicity
# Reduce resource usage for development

postgresql:
  chartManaged: true
  auth:
    password: "" # You must set this, or use a secret manager
  persistence:
    size: 5Gi

redis:
  chartManaged: true
  master:
    persistence:
      size: 2Gi

opensearch:
  chartManaged: true
  master:
    persistence:
      size: 5Gi

app:
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

langwatch_nlp:
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 1500m
      memory: 2Gi

langevals:
  resources:
    requests:
      cpu: 500m
      memory: 1.5Gi
    limits:
      cpu: 2000m
      memory: 3Gi
```
</details>

## Migration from Pre-1.0.0 Helm Charts

If you're upgrading from a LangWatch Helm chart version before 1.0.0, you may need to preserve your existing PostgreSQL data.

### Preserve Existing Data

In your values file, uncomment and set the `existingClaim` field:

```yaml
postgresql:
  primary:
    persistence:
      existingClaim: "data-langwatch-postgres-0"
      size: 20Gi
```

This will prevent data loss during the upgrade process.

## Advanced Configuration

### External Services

Disable built-in services and use external ones:

```yaml
# Use external PostgreSQL
postgresql:
  chartManaged: false
  external:
    existingSecret: "my-postgres-secret"

# Use external Redis
redis:
  chartManaged: false
  external:
    existingSecret: "my-redis-secret"

# Use external OpenSearch
opensearch:
  chartManaged: false
  external:
    existingSecret: "my-opensearch-secret"
```

### Ingress Configuration

Enable ingress for external access:

```yaml
ingress:
  enabled: true
  className: "nginx"
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

Customize resource allocation:

```yaml
app:
  resources:
    requests:
      cpu: 500m
      memory: 2Gi
    limits:
      cpu: 2000m
      memory: 8Gi

langwatch_nlp:
  resources:
    requests:
      cpu: 1000m
      memory: 4Gi
    limits:
      cpu: 4000m
      memory: 8Gi
```

## Common Operations

### Upgrade

```bash
# Upgrade with your values
helm upgrade langwatch ./langwatch -f my-values.yaml
```

### Uninstall

```bash
# Remove the Helm release
helm uninstall langwatch

# Remove persistent volumes (WARNING: deletes all data!)
kubectl delete pvc -l app.kubernetes.io/instance=langwatch
```

### Check Status

```bash
# View release status
helm status langwatch

# Check pod status
kubectl get pods -l app.kubernetes.io/name=langwatch

# View logs
kubectl logs -f deployment/langwatch-app
```

## Troubleshooting

### Common Issues

**Port forwarding not working:**
```bash
# Check if the service exists
kubectl get svc langwatch-app

# Verify the service is running
kubectl describe svc langwatch-app
```

**PostgreSQL connection issues:**
```bash
# Check PostgreSQL pod status
kubectl get pods -l app.kubernetes.io/name=postgresql

# View PostgreSQL logs
kubectl logs -f deployment/langwatch-postgresql
```

**Resource constraints:**
```bash
# Check pod resource usage
kubectl top pods -l app.kubernetes.io/name=langwatch

# Describe pods for resource issues
kubectl describe pods -l app.kubernetes.io/name=langwatch
```

## Quick Reference

### Default Ports

| Service       | Port | Description      |
| ------------- | ---- | ---------------- |
| LangWatch App | 5560 | Main application |
| PostgreSQL    | 5432 | Database         |
| Redis         | 6379 | Cache            |
| OpenSearch    | 9200 | Search engine    |

### Required Environment Variables

| Variable               | Description            | Auto-generated?    |
| ---------------------- | ---------------------- | ------------------ |
| `NEXTAUTH_SECRET`      | Session encryption     | ✅ (dev) / ❌ (prod) |
| `API_TOKEN_JWT_SECRET` | API token signing      | ✅ (dev) / ❌ (prod) |
| `CRON_API_KEY`         | Cronjob authentication | ✅ (dev) / ❌ (prod) |
| `METRICS_API_KEY`      | Metrics authentication | ✅ (dev) / ❌ (prod) |
