## LangWatch Helm Chart

Deploy LangWatch to Kubernetes. Includes the web app, workers, NLP service, Langevals, and managed dependencies (ClickHouse, PostgreSQL, Redis, Prometheus).

### Prerequisites

- Kubernetes 1.24+, Helm 3.12+
- A default StorageClass for persistent components if chart-managed

### Install

Compose values from `examples/overlays/` — pick a **size**, an **access method**, then stack infrastructure overlays:

```bash
# Local dev on Kind → http://localhost:30560
helm install lw ./charts/langwatch \
  -f examples/overlays/size-dev.yaml \
  -f examples/overlays/access-nodeport.yaml \
  -f examples/overlays/local-images.yaml \
  --set autogen.enabled=true

# Production with Ingress + TLS
helm install lw ./charts/langwatch -n langwatch --create-namespace \
  -f examples/overlays/size-prod.yaml \
  -f examples/overlays/access-ingress.yaml \
  --set "app.http.baseHost=https://langwatch.example.com" \
  --set "app.http.publicUrl=https://langwatch.example.com" \
  --set "ingress.hosts[0].host=langwatch.example.com" \
  --set "ingress.tls[0].hosts[0]=langwatch.example.com"

# HA production with external databases and S3 cold storage
helm install lw ./charts/langwatch -n langwatch --create-namespace \
  -f examples/overlays/size-ha.yaml \
  -f examples/overlays/access-ingress.yaml \
  -f examples/overlays/postgres-external.yaml \
  -f examples/overlays/redis-external.yaml \
  -f examples/overlays/cold-storage-s3.yaml \
  --set clickhouse.objectStorage.bucket=my-bucket \
  --set clickhouse.objectStorage.region=eu-central-1
```

### Overlays

All overlays live in `examples/overlays/`:

| Overlay | Description |
|---------|-------------|
| **Size** (pick one) | |
| `size-minimal` | CI smoke test — absolute minimum resources |
| `size-dev` | Local dev / small team |
| `size-prod` | Production — single-node ClickHouse, 2 app/worker replicas |
| `size-ha` | HA production — 3-node replicated ClickHouse, 3 app/worker replicas |
| **Access** (pick one) | |
| `access-nodeport` | Kind: NodePort 30560 → http://localhost:30560 |
| `access-ingress` | Cloud: Ingress + TLS (nginx class) |
| **Infrastructure** (stack any) | |
| `local-images` | `pullPolicy: Never` for Kind / minikube |
| `clickhouse-external` | Use an external ClickHouse instance |
| `clickhouse-replicated` | Upgrade chart-managed ClickHouse to 3-node |
| `postgres-external` | External PostgreSQL (RDS, Cloud SQL) |
| `redis-external` | External Redis (ElastiCache, Memorystore) |
| `cold-storage-s3` | S3 cold storage tiering + backups |

### All-in-one profiles

For common scenarios, use the bundled profiles in `examples/`:

| Profile | Equivalent overlays |
|---------|-------------------|
| `values-local.yaml` | `size-dev` + `access-nodeport` + `local-images` + autogen |
| `values-hosted-prod.yaml` | `size-prod` + `access-ingress` + `postgres-external` + `redis-external` + secrets |
| `values-scalable-prod.yaml` | `size-ha` + `access-ingress` + `postgres-external` + `redis-external` + `cold-storage-s3` + secrets |

```bash
# All-in-one local dev:
helm install lw . -f examples/values-local.yaml
```

### Upgrade / Uninstall

```bash
helm upgrade lw . -f examples/overlays/size-dev.yaml -f examples/overlays/access-nodeport.yaml
helm uninstall lw
```

### Secrets

Use `secretKeyRef` to reference existing Kubernetes Secrets instead of inlining values:

```yaml
app:
  credentialsEncryptionKey:
    secretKeyRef: { name: langwatch-secrets, key: credentialsEncryptionKey }
```

Create the secret first:

```bash
kubectl create secret generic langwatch-secrets -n langwatch \
  --from-literal=credentialsEncryptionKey=$(openssl rand -hex 32) \
  --from-literal=cronApiKey=$(openssl rand -hex 16) \
  --from-literal=nextAuthSecret=$(openssl rand -hex 16)
```

For development, set `autogen.enabled: true` to auto-generate all secrets.

### Dependencies

| Component | Chart-managed | External |
|-----------|--------------|----------|
| **ClickHouse** | `clickhouse.chartManaged: true` — single or replicated with auto-tuning | `clickhouse.external.url` via secretKeyRef |
| **PostgreSQL** | `postgresql.chartManaged: true` | `postgresql.external.connectionString` via secretKeyRef |
| **Redis** | `redis.chartManaged: true` | `redis.external.connectionString` via secretKeyRef |
| **Prometheus** | `prometheus.chartManaged: true` | Optional — for metrics collection |

For a complete installation guide, visit the [documentation](https://docs.langwatch.ai/self-hosting/kubernetes-helm).

### Regenerate this table

The Parameters section below can be auto-generated from `values.yaml` using Bitnami's README generator for Helm charts:

```bash
npx @bitnami/readme-generator-for-helm --readme ./README.md --values values.yaml
```

## Parameters

### Global configuration

| Name                              | Description                                                                  | Value        |
| --------------------------------- | ---------------------------------------------------------------------------- | ------------ |
| `global.env`                      | Deployment environment for all components.                                   | `production` |
| `global.podSecurityContext`       | Default pod security context (applied cluster-wide unless overridden).       | `{}`         |
| `global.containerSecurityContext` | Default container security context (applied cluster-wide unless overridden). | `{}`         |
| `global.scheduling`               | Global scheduling defaults for all pods.                                     |              |
| `global.scheduling.nodeSelector`  | Node selector labels for all pods.                                           | `{}`         |
| `global.scheduling.affinity`      | Affinity rules for all pods.                                                 | `{}`         |
| `global.scheduling.tolerations`   | Tolerations applied to all pods.                                             | `[]`         |

### Auto-generation

| Name                      | Description                                                      | Value   |
| ------------------------- | ---------------------------------------------------------------- | ------- |
| `autogen.enabled`         | Enable automatic secret generation (development only).           | `false` |
| `autogen.secretNames.app` | Secret name for the main LangWatch app (autogenerated if empty). | `""`    |

### Secrets

| Name                                          | Description                                          | Value |
| --------------------------------------------- | ---------------------------------------------------- | ----- |
| `secrets.existingSecret`                      | Name of an existing secret containing required keys. | `""`  |
| `secrets.secretKeys.credentialsEncryptionKey` | Key name for credentials encryption.                 | `""`  |
| `secrets.secretKeys.cronApiKey`               | Key name for cron API key.                           | `""`  |
| `secrets.secretKeys.nextAuthSecret`           | Key name for NextAuth secret.                        | `""`  |

### Container images

| Name                              | Description                  | Value |
| --------------------------------- | ---------------------------- | ----- |
| `images.app.repository`           | App image repository.        | `""`  |
| `images.app.tag`                  | App image tag.               | `""`  |
| `images.app.pullPolicy`           | App image pull policy.       | `""`  |
| `images.langwatch_nlp.repository` | NLP image repository.        | `""`  |
| `images.langwatch_nlp.tag`        | NLP image tag.               | `""`  |
| `images.langwatch_nlp.pullPolicy` | NLP image pull policy.       | `""`  |
| `images.langevals.repository`     | Langevals image repository.  | `""`  |
| `images.langevals.tag`            | Langevals image tag.         | `""`  |
| `images.langevals.pullPolicy`     | Langevals image pull policy. | `""`  |

### LangWatch app

| Name                                                                    | Description                                                                               | Value                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `app.replicaCount`                                                      | Number of application replicas.                                                           | `1`                     |
| `app.service`                                                           | Service configuration for the app.                                                        |                         |
| `app.service.type`                                                      | Service type.                                                                             | `ClusterIP`             |
| `app.service.port`                                                      | Service port.                                                                             | `5560`                  |
| `app.resources`                                                         | Resource requests and limits for the app.                                                 |                         |
| `app.resources.requests.cpu`                                            | Requested CPU.                                                                            | `250m`                  |
| `app.resources.requests.memory`                                         | Requested memory.                                                                         | `2Gi`                   |
| `app.resources.limits.cpu`                                              | CPU limit.                                                                                | `1000m`                 |
| `app.resources.limits.memory`                                           | Memory limit.                                                                             | `4Gi`                   |
| `app.nodeEnv`                                                           | Node.js environment override (falls back to global.env if empty).                         | `""`                    |
| `app.credentialsEncryptionKey`                                          | Configuration for credentials encryption.                                                 |                         |
| `app.credentialsEncryptionKey.value`                                    | Encryption key value (not recommended in production).                                     | `""`                    |
| `app.credentialsEncryptionKey.secretKeyRef`                             | Reference to a secret holding the encryption key.                                         | `{}`                    |
| `app.cronApiKey`                                                        | API key used by cron jobs for authentication.                                             |                         |
| `app.cronApiKey.value`                                                  | Cron API key value.                                                                       | `""`                    |
| `app.cronApiKey.secretKeyRef`                                           | Reference to a secret holding the cron API key.                                           | `{}`                    |
| `app.http`                                                              | HTTP configuration for base/public URLs.                                                  |                         |
| `app.http.baseHost`                                                     | Internal base URL.                                                                        | `http://localhost:5560` |
| `app.http.publicUrl`                                                    | Public URL for users.                                                                     | `http://localhost:5560` |
| `app.features`                                                          | Feature flags for the app.                                                                |                         |
| `app.features.skipEnvValidation`                                        | Skip env var validation (dev only).                                                       | `false`                 |
| `app.features.disablePiiRedaction`                                      | Disable PII redaction.                                                                    | `false`                 |
| `app.upstreams`                                                         | Upstream connections from app to internal services.                                       |                         |
| `app.upstreams.nlp.scheme`                                              | Scheme for NLP upstream.                                                                  | `http`                  |
| `app.upstreams.nlp.name`                                                | Service name for NLP upstream. If empty, defaults to {{ .Release.Name }}-langwatch-nlp.   | `""`                    |
| `app.upstreams.nlp.port`                                                | Port for NLP upstream.                                                                    | `5561`                  |
| `app.upstreams.langevals.scheme`                                        | Scheme for Langevals upstream.                                                            | `http`                  |
| `app.upstreams.langevals.name`                                          | Service name for Langevals upstream. If empty, defaults to {{ .Release.Name }}-langevals. | `""`                    |
| `app.upstreams.langevals.port`                                          | Port for Langevals upstream.                                                              | `5562`                  |
| `app.evaluators`                                                        | Evaluator providers configuration.                                                        |                         |
| `app.evaluators.azureOpenAI`                                            | Azure OpenAI evaluator configuration.                                                     |                         |
| `app.evaluators.azureOpenAI.enabled`                                    | Enable Azure OpenAI evaluator.                                                            | `false`                 |
| `app.evaluators.azureOpenAI.endpoint.value`                             | Azure OpenAI endpoint.                                                                    | `""`                    |
| `app.evaluators.azureOpenAI.apiKey.value`                               | Azure OpenAI API key.                                                                     | `""`                    |
| `app.evaluators.azureOpenAI.endpoint.secretKeyRef`                      | Secret ref for Azure OpenAI endpoint.                                                     | `{}`                    |
| `app.evaluators.azureOpenAI.apiKey.secretKeyRef`                        | Secret ref for Azure OpenAI API key.                                                      | `{}`                    |
| `app.evaluators.google`                                                 | Google evaluator configuration.                                                           |                         |
| `app.evaluators.google.enabled`                                         | Enable Google evaluator.                                                                  | `false`                 |
| `app.evaluators.google.credentials.value`                               | Google credentials JSON (base64 or inline).                                               | `""`                    |
| `app.evaluators.google.credentials.secretKeyRef`                        | Secret ref for Google credentials JSON.                                                   | `{}`                    |
| `app.datasetObjectStorage`                                              | Object storage configuration for datasets.                                                |                         |
| `app.datasetObjectStorage.enabled`                                      | Enable dataset object storage.                                                            | `false`                 |
| `app.datasetObjectStorage.provider`                                     | Object storage provider.                                                                  | `awsS3`                 |
| `app.datasetObjectStorage.bucket`                                       | Bucket name for datasets.                                                                 | `langwatch-dataset`     |
| `app.datasetObjectStorage.providers.awsS3`                              | AWS S3 provider configuration.                                                            |                         |
| `app.datasetObjectStorage.providers.awsS3.endpoint.value`               | Custom S3 endpoint.                                                                       | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.accessKeyId.value`            | S3 access key ID.                                                                         | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.secretAccessKey.value`        | S3 secret access key.                                                                     | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.keySalt.value`                | Optional key salt.                                                                        | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.endpoint.secretKeyRef`        | Secret ref for custom S3 endpoint.                                                        | `{}`                    |
| `app.datasetObjectStorage.providers.awsS3.accessKeyId.secretKeyRef`     | Secret ref for S3 access key ID.                                                          | `{}`                    |
| `app.datasetObjectStorage.providers.awsS3.secretAccessKey.secretKeyRef` | Secret ref for S3 secret access key.                                                      | `{}`                    |
| `app.datasetObjectStorage.providers.awsS3.keySalt.secretKeyRef`         | Secret ref for optional key salt.                                                         | `{}`                    |
| `app.email`                                                             | Email provider configuration.                                                             |                         |
| `app.email.enabled`                                                     | Enable email notifications.                                                               | `false`                 |
| `app.email.defaultFrom`                                                 | Default "from" address.                                                                   | `""`                    |
| `app.email.provider`                                                    | Email provider.                                                                           | `sendgrid`              |
| `app.email.providers.sendgrid`                                          | Sendgrid provider configuration.                                                          |                         |
| `app.email.providers.sendgrid.apiKey.value`                             | Sendgrid API key.                                                                         | `""`                    |
| `app.email.providers.sendgrid.apiKey.secretKeyRef`                      | Secret ref for SendGrid API key.                                                          | `{}`                    |
| `app.nextAuth`                                                          | NextAuth configuration and providers.                                                     |                         |
| `app.nextAuth.provider`                                                 | Default auth provider.                                                                    | `email`                 |
| `app.nextAuth.secret.value`                                             | NextAuth secret value (not recommended inline for production).                            | `""`                    |
| `app.nextAuth.secret.secretKeyRef`                                      | Secret ref for NextAuth secret.                                                           | `{}`                    |
| `app.nextAuth.providers`                                                | OAuth providers configuration.                                                            |                         |
| `app.nextAuth.providers.auth0`                                          | Auth0 OAuth configuration.                                                                |                         |
| `app.nextAuth.providers.auth0.clientId.value`                           | Auth0 client ID.                                                                          | `""`                    |
| `app.nextAuth.providers.auth0.clientSecret.value`                       | Auth0 client secret.                                                                      | `""`                    |
| `app.nextAuth.providers.auth0.issuer.value`                             | Auth0 issuer URL.                                                                         | `""`                    |
| `app.nextAuth.providers.auth0.clientId.value`                           | Auth0 client ID.                                                                          | `""`                    |
| `app.nextAuth.providers.auth0.clientId.secretKeyRef`                    | Secret ref for Auth0 client ID.                                                           | `{}`                    |
| `app.nextAuth.providers.auth0.clientSecret.value`                       | Auth0 client secret.                                                                      | `""`                    |
| `app.nextAuth.providers.auth0.clientSecret.secretKeyRef`                | Secret ref for Auth0 client secret.                                                       | `{}`                    |
| `app.nextAuth.providers.auth0.issuer.value`                             | Auth0 issuer URL.                                                                         | `""`                    |
| `app.nextAuth.providers.auth0.issuer.secretKeyRef`                      | Secret ref for Auth0 issuer URL.                                                          | `{}`                    |
| `app.nextAuth.providers.azureAd`                                        | Azure AD OAuth configuration.                                                             |                         |
| `app.nextAuth.providers.azureAd.clientId.value`                         | Azure AD client ID.                                                                       | `""`                    |
| `app.nextAuth.providers.azureAd.clientId.secretKeyRef`                  | Secret ref for Azure AD client ID.                                                        | `{}`                    |
| `app.nextAuth.providers.azureAd.clientSecret.value`                     | Azure AD client secret.                                                                   | `""`                    |
| `app.nextAuth.providers.azureAd.clientSecret.secretKeyRef`              | Secret ref for Azure AD client secret.                                                    | `{}`                    |
| `app.nextAuth.providers.azureAd.tenantId.value`                         | Azure AD tenant ID.                                                                       | `""`                    |
| `app.nextAuth.providers.azureAd.tenantId.secretKeyRef`                  | Secret ref for Azure AD tenant ID.                                                        | `{}`                    |
| `app.nextAuth.providers.cognito`                                        | AWS Cognito OAuth configuration.                                                          |                         |
| `app.nextAuth.providers.cognito.clientId.value`                         | Cognito client ID.                                                                        | `""`                    |
| `app.nextAuth.providers.cognito.clientId.secretKeyRef`                  | Secret ref for Cognito client ID.                                                         | `{}`                    |
| `app.nextAuth.providers.cognito.clientSecret.value`                     | Cognito client secret.                                                                    | `""`                    |
| `app.nextAuth.providers.cognito.clientSecret.secretKeyRef`              | Secret ref for Cognito client secret.                                                     | `{}`                    |
| `app.nextAuth.providers.cognito.issuer.value`                           | Cognito issuer URL.                                                                       | `""`                    |
| `app.nextAuth.providers.cognito.issuer.secretKeyRef`                    | Secret ref for Cognito issuer URL.                                                        | `{}`                    |
| `app.nextAuth.providers.github`                                         | GitHub OAuth configuration.                                                               |                         |
| `app.nextAuth.providers.github.clientId.value`                          | GitHub client ID.                                                                         | `""`                    |
| `app.nextAuth.providers.github.clientId.secretKeyRef`                   | Secret ref for GitHub client ID.                                                          | `{}`                    |
| `app.nextAuth.providers.github.clientSecret.value`                      | GitHub client secret.                                                                     | `""`                    |
| `app.nextAuth.providers.github.clientSecret.secretKeyRef`               | Secret ref for GitHub client secret.                                                      | `{}`                    |
| `app.nextAuth.providers.gitlab`                                         | GitLab OAuth configuration.                                                               |                         |
| `app.nextAuth.providers.gitlab.clientId.value`                          | GitLab client ID.                                                                         | `""`                    |
| `app.nextAuth.providers.gitlab.clientId.secretKeyRef`                   | Secret ref for GitLab client ID.                                                          | `{}`                    |
| `app.nextAuth.providers.gitlab.clientSecret.value`                      | GitLab client secret.                                                                     | `""`                    |
| `app.nextAuth.providers.gitlab.clientSecret.secretKeyRef`               | Secret ref for GitLab client secret.                                                      | `{}`                    |
| `app.nextAuth.providers.google`                                         | Google OAuth configuration.                                                               |                         |
| `app.nextAuth.providers.google.clientId.value`                          | Google client ID.                                                                         | `""`                    |
| `app.nextAuth.providers.google.clientId.secretKeyRef`                   | Secret ref for Google client ID.                                                          | `{}`                    |
| `app.nextAuth.providers.google.clientSecret.value`                      | Google client secret.                                                                     | `""`                    |
| `app.nextAuth.providers.google.clientSecret.secretKeyRef`               | Secret ref for Google client secret.                                                      | `{}`                    |
| `app.nextAuth.providers.okta`                                           | Okta OAuth configuration.                                                                 |                         |
| `app.nextAuth.providers.okta.clientId.value`                            | Okta client ID.                                                                           | `""`                    |
| `app.nextAuth.providers.okta.clientId.secretKeyRef`                     | Secret ref for Okta client ID.                                                            | `{}`                    |
| `app.nextAuth.providers.okta.clientSecret.value`                        | Okta client secret.                                                                       | `""`                    |
| `app.nextAuth.providers.okta.clientSecret.secretKeyRef`                 | Secret ref for Okta client secret.                                                        | `{}`                    |
| `app.nextAuth.providers.okta.issuer.value`                              | Okta issuer URL.                                                                          | `""`                    |
| `app.nextAuth.providers.okta.issuer.secretKeyRef`                       | Secret ref for Okta issuer URL.                                                           | `{}`                    |
| `app.telemetry`                                                         | Telemetry configuration.                                                                  |                         |
| `app.telemetry.usage`                                                   | Usage analytics.                                                                          |                         |
| `app.telemetry.usage.enabled`                                           | Enable anonymous usage analytics.                                                         | `true`                  |
| `app.telemetry.metrics`                                                 | Metrics configuration.                                                                    |                         |
| `app.telemetry.metrics.enabled`                                         | Enable metrics collection.                                                                | `false`                 |
| `app.telemetry.metrics.apiKey.value`                                    | Metrics API key.                                                                          | `""`                    |
| `app.telemetry.metrics.apiKey.secretKeyRef`                             | Secret ref for metrics API key.                                                           | `{}`                    |

### CronJobs Kubernetes overrides


### Langevals Kubernetes overrides


### NLP Kubernetes overrides


### App Kubernetes overrides

| Name                                  | Description                                         | Value |
| ------------------------------------- | --------------------------------------------------- | ----- |
| `app.podSecurityContext`              | Pod security context overrides for app.             | `{}`  |
| `app.containerSecurityContext`        | Container security context overrides for app.       | `{}`  |
| `app.podDisruptionBudget`             | PodDisruptionBudget spec overrides.                 | `{}`  |
| `app.nodeSelector`                    | Node selector overrides.                            | `{}`  |
| `app.tolerations`                     | Tolerations overrides.                              | `[]`  |
| `app.affinity`                        | Affinity overrides.                                 | `{}`  |
| `app.topologySpreadConstraints`       | Topology spread constraints.                        | `[]`  |
| `app.pod`                             | Pod-level metadata.                                 |       |
| `app.pod.annotations`                 | Additional pod annotations.                         | `{}`  |
| `app.pod.labels`                      | Additional pod labels.                              | `{}`  |
| `app.deployment`                      | Deployment-level metadata and strategy.             |       |
| `app.deployment.annotations`          | Additional deployment annotations.                  | `{}`  |
| `app.deployment.labels`               | Additional deployment labels.                       | `{}`  |
| `app.deployment.strategy`             | Deployment strategy overrides.                      | `{}`  |
| `app.deployment.revisionHistoryLimit` | Number of old replicasets to retain.                | `10`  |
| `app.extraEnvs`                       | Additional environment variables for app container. | `[]`  |
| `app.extraContainers`                 | Additional sidecar containers.                      | `[]`  |
| `app.extraVolumes`                    | Additional pod volumes.                             | `[]`  |
| `app.extraInitContainers`             | Additional init containers.                         | `[]`  |
| `app.extraAppLifecycle`               | Additional lifecycle hooks for app container.       | `{}`  |
| `app.extraAppVolumeMounts`            | Additional volume mounts for app container.         | `[]`  |

### Workers

| Name                                      | Description                                     | Value   |
| ----------------------------------------- | ----------------------------------------------- | ------- |
| `workers.enabled`                         | Deploy workers as a separate pod.               | `true`  |
| `workers.replicaCount`                    | Number of worker replicas.                      | `1`     |
| `workers.resources`                       | Resource requests and limits for workers.       |         |
| `workers.resources.requests.cpu`          | Requested CPU.                                  | `250m`  |
| `workers.resources.requests.memory`       | Requested memory.                               | `2Gi`   |
| `workers.resources.limits.cpu`            | CPU limit.                                      | `1000m` |
| `workers.resources.limits.memory`         | Memory limit.                                   | `4Gi`   |
| `workers.podSecurityContext`              | Pod security context overrides.                 | `{}`    |
| `workers.containerSecurityContext`        | Container security context overrides.           | `{}`    |
| `workers.podDisruptionBudget`             | PodDisruptionBudget spec overrides.             | `{}`    |
| `workers.nodeSelector`                    | Node selector overrides.                        | `{}`    |
| `workers.tolerations`                     | Tolerations overrides.                          | `[]`    |
| `workers.affinity`                        | Affinity overrides.                             | `{}`    |
| `workers.pod`                             | Pod-level metadata.                             |         |
| `workers.pod.annotations`                 | Additional pod annotations.                     | `{}`    |
| `workers.pod.labels`                      | Additional pod labels.                          | `{}`    |
| `workers.deployment`                      | Deployment-level metadata and strategy.         |         |
| `workers.deployment.annotations`          | Additional deployment annotations.              | `{}`    |
| `workers.deployment.labels`               | Additional deployment labels.                   | `{}`    |
| `workers.deployment.strategy`             | Deployment strategy overrides.                  | `{}`    |
| `workers.deployment.revisionHistoryLimit` | Number of old replicasets to retain.            | `10`    |
| `workers.extraEnvs`                       | Additional environment variables.               | `[]`    |
| `workers.extraContainers`                 | Additional sidecar containers.                  | `[]`    |
| `workers.extraVolumes`                    | Additional pod volumes.                         | `[]`    |
| `workers.extraInitContainers`             | Additional init containers.                     | `[]`    |
| `workers.extraVolumeMounts`               | Additional volume mounts for workers container. | `[]`    |

### NLP service

| Name                                            | Description                                   | Value           |
| ----------------------------------------------- | --------------------------------------------- | --------------- |
| `langwatch_nlp.replicaCount`                    | Number of NLP service replicas.               | `1`             |
| `langwatch_nlp.service`                         | Service configuration for NLP.                |                 |
| `langwatch_nlp.service.type`                    | Service type.                                 | `ClusterIP`     |
| `langwatch_nlp.service.port`                    | Service port.                                 | `5561`          |
| `langwatch_nlp.resources`                       | Resource requests and limits.                 |                 |
| `langwatch_nlp.resources.requests.cpu`          | Requested CPU.                                | `1000m`         |
| `langwatch_nlp.resources.requests.memory`       | Requested memory.                             | `2Gi`           |
| `langwatch_nlp.resources.limits.cpu`            | CPU limit.                                    | `2000m`         |
| `langwatch_nlp.resources.limits.memory`         | Memory limit.                                 | `4Gi`           |
| `langwatch_nlp.upstreams`                       | Upstream to app (callbacks, etc.).            |                 |
| `langwatch_nlp.upstreams.langwatch.scheme`      | Scheme to app.                                | `http`          |
| `langwatch_nlp.upstreams.langwatch.name`        | Service name for app.                         | `langwatch-app` |
| `langwatch_nlp.upstreams.langwatch.port`        | Port to app.                                  | `5560`          |
| `langwatch_nlp.podSecurityContext`              | Pod security context overrides.               | `{}`            |
| `langwatch_nlp.containerSecurityContext`        | Container security context overrides.         | `{}`            |
| `langwatch_nlp.podDisruptionBudget`             | PodDisruptionBudget spec overrides.           | `{}`            |
| `langwatch_nlp.nodeSelector`                    | Node selector overrides.                      | `{}`            |
| `langwatch_nlp.tolerations`                     | Tolerations overrides.                        | `[]`            |
| `langwatch_nlp.affinity`                        | Affinity overrides.                           | `{}`            |
| `langwatch_nlp.topologySpreadConstraints`       | Topology spread constraints.                  | `[]`            |
| `langwatch_nlp.pod`                             | Pod-level metadata.                           |                 |
| `langwatch_nlp.pod.annotations`                 | Additional pod annotations.                   | `{}`            |
| `langwatch_nlp.pod.labels`                      | Additional pod labels.                        | `{}`            |
| `langwatch_nlp.deployment`                      | Deployment-level metadata and strategy.       |                 |
| `langwatch_nlp.deployment.annotations`          | Additional deployment annotations.            | `{}`            |
| `langwatch_nlp.deployment.labels`               | Additional deployment labels.                 | `{}`            |
| `langwatch_nlp.deployment.strategy`             | Deployment strategy overrides.                | `{}`            |
| `langwatch_nlp.deployment.revisionHistoryLimit` | Number of old replicasets to retain.          | `10`            |
| `langwatch_nlp.extraEnvs`                       | Additional environment variables.             | `[]`            |
| `langwatch_nlp.extraContainers`                 | Additional sidecar containers.                | `[]`            |
| `langwatch_nlp.extraVolumes`                    | Additional pod volumes.                       | `[]`            |
| `langwatch_nlp.extraInitContainers`             | Additional init containers.                   | `[]`            |
| `langwatch_nlp.extraNlpLifecycle`               | Additional lifecycle hooks for NLP container. | `{}`            |
| `langwatch_nlp.extraNlpVolumeMounts`            | Additional volume mounts for NLP container.   | `[]`            |

### Langevals service

| Name                                        | Description                             | Value       |
| ------------------------------------------- | --------------------------------------- | ----------- |
| `langevals.replicaCount`                    | Number of Langevals replicas.           | `1`         |
| `langevals.service`                         | Service configuration for Langevals.    |             |
| `langevals.service.type`                    | Service type.                           | `ClusterIP` |
| `langevals.service.port`                    | Service port.                           | `5562`      |
| `langevals.resources`                       | Resource requests and limits.           |             |
| `langevals.resources.requests.cpu`          | Requested CPU.                          | `1000m`     |
| `langevals.resources.requests.memory`       | Requested memory.                       | `6Gi`       |
| `langevals.resources.limits.cpu`            | CPU limit.                              | `2000m`     |
| `langevals.resources.limits.memory`         | Memory limit.                           | `8Gi`       |
| `langevals.podSecurityContext`              | Pod security context overrides.         | `{}`        |
| `langevals.containerSecurityContext`        | Container security context overrides.   | `{}`        |
| `langevals.podDisruptionBudget`             | PodDisruptionBudget spec overrides.     | `{}`        |
| `langevals.nodeSelector`                    | Node selector overrides.                | `{}`        |
| `langevals.tolerations`                     | Tolerations overrides.                  | `[]`        |
| `langevals.affinity`                        | Affinity overrides.                     | `{}`        |
| `langevals.topologySpreadConstraints`       | Topology spread constraints.            | `[]`        |
| `langevals.pod`                             | Pod-level metadata.                     |             |
| `langevals.pod.annotations`                 | Additional pod annotations.             | `{}`        |
| `langevals.pod.labels`                      | Additional pod labels.                  | `{}`        |
| `langevals.deployment`                      | Deployment-level metadata and strategy. |             |
| `langevals.deployment.annotations`          | Additional deployment annotations.      | `{}`        |
| `langevals.deployment.labels`               | Additional deployment labels.           | `{}`        |
| `langevals.deployment.strategy`             | Deployment strategy overrides.          | `{}`        |
| `langevals.deployment.revisionHistoryLimit` | Number of old replicasets to retain.    | `10`        |
| `langevals.extraEnvs`                       | Additional environment variables.       | `[]`        |
| `langevals.extraContainers`                 | Additional sidecar containers.          | `[]`        |
| `langevals.extraVolumes`                    | Additional pod volumes.                 | `[]`        |
| `langevals.extraInitContainers`             | Additional init containers.             | `[]`        |
| `langevals.extraLangevalsLifecycle`         | Additional lifecycle hooks.             | `{}`        |
| `langevals.extraLangevalsVolumeMounts`      | Additional volume mounts.               | `[]`        |

### CronJobs

| Name                                            | Description                                        | Value                                       |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| `cronjobs.enabled`                              | Enable all cron jobs.                              | `true`                                      |
| `cronjobs.labels`                               | Additional labels for CronJob resources.           | `{}`                                        |
| `cronjobs.image`                                | Cron job image.                                    |                                             |
| `cronjobs.image.repository`                     | Image repository.                                  | `curlimages/curl`                           |
| `cronjobs.image.tag`                            | Image tag.                                         | `8.12.1`                                    |
| `cronjobs.image.pullPolicy`                     | Image pull policy.                                 | `IfNotPresent`                              |
| `cronjobs.resources`                            | Resource requests and limits for jobs.             |                                             |
| `cronjobs.resources.requests.cpu`               | Requested CPU.                                     | `100m`                                      |
| `cronjobs.resources.requests.memory`            | Requested memory.                                  | `64Mi`                                      |
| `cronjobs.resources.limits.cpu`                 | CPU limit.                                         | `100m`                                      |
| `cronjobs.resources.limits.memory`              | Memory limit.                                      | `64Mi`                                      |
| `cronjobs.jobs`                                 | Individual cron job endpoints and schedules.       |                                             |
| `cronjobs.jobs.topicClustering`                 | Topic clustering job.                              |                                             |
| `cronjobs.jobs.topicClustering.enabled`         | Enable topic clustering job.                       | `true`                                      |
| `cronjobs.jobs.topicClustering.schedule`        | Cron schedule.                                     | `0 0 * * *`                                 |
| `cronjobs.jobs.topicClustering.endpoint`        | Endpoint path.                                     | `/api/cron/schedule_topic_clustering`       |
| `cronjobs.jobs.alertTriggers`                   | Alert triggers job.                                |                                             |
| `cronjobs.jobs.alertTriggers.enabled`           | Enable alert triggers job.                         | `true`                                      |
| `cronjobs.jobs.alertTriggers.schedule`          | Cron schedule.                                     | `*/3 * * * *`                               |
| `cronjobs.jobs.alertTriggers.endpoint`          | Endpoint path.                                     | `/api/cron/triggers`                        |
| `cronjobs.jobs.tracesRetentionCleanup`          | Traces retention cleanup job.                      |                                             |
| `cronjobs.jobs.tracesRetentionCleanup.enabled`  | Enable traces retention cleanup job.               | `true`                                      |
| `cronjobs.jobs.tracesRetentionCleanup.schedule` | Cron schedule.                                     | `0 1 * * *`                                 |
| `cronjobs.jobs.tracesRetentionCleanup.endpoint` | Endpoint path.                                     | `/api/cron/traces_retention_period_cleanup` |
| `cronjobs.podSecurityContext`                   | Pod security context overrides.                    | `{}`                                        |
| `cronjobs.containerSecurityContext`             | Container security context overrides.              | `{}`                                        |
| `cronjobs.nodeSelector`                         | Node selector overrides.                           | `{}`                                        |
| `cronjobs.tolerations`                          | Tolerations overrides.                             | `[]`                                        |
| `cronjobs.affinity`                             | Affinity overrides.                                | `{}`                                        |
| `cronjobs.topologySpreadConstraints`            | Topology spread constraints.                       | `[]`                                        |
| `cronjobs.cronjob`                              | CronJob-level metadata.                            |                                             |
| `cronjobs.cronjob.annotations`                  | CronJob annotations.                               | `{}`                                        |
| `cronjobs.cronjob.labels`                       | CronJob labels.                                    | `{}`                                        |
| `cronjobs.job`                                  | Job-level metadata.                                |                                             |
| `cronjobs.job.annotations`                      | Job annotations.                                   | `{}`                                        |
| `cronjobs.job.labels`                           | Job labels.                                        | `{}`                                        |
| `cronjobs.pod`                                  | Pod-level metadata.                                |                                             |
| `cronjobs.pod.annotations`                      | Pod annotations.                                   | `{}`                                        |
| `cronjobs.pod.labels`                           | Pod labels.                                        | `{}`                                        |
| `cronjobs.extraEnvs`                            | Additional environment variables.                  | `[]`                                        |
| `cronjobs.extraContainers`                      | Additional containers.                             | `[]`                                        |
| `cronjobs.extraVolumes`                         | Additional volumes.                                | `[]`                                        |
| `cronjobs.extraInitContainers`                  | Additional init containers.                        | `[]`                                        |
| `cronjobs.extraCronjobsLifecycle`               | Additional lifecycle hooks for cron job container. | `{}`                                        |
| `cronjobs.extraVolumeMounts`                    | Additional volume mounts for cron job container.   | `[]`                                        |

### Ingress

| Name                  | Description                                | Value   |
| --------------------- | ------------------------------------------ | ------- |
| `ingress.enabled`     | Enable ingress.                            | `false` |
| `ingress.className`   | Ingress class name (e.g., nginx, traefik). | `""`    |
| `ingress.annotations` | Additional ingress annotations.            | `{}`    |
| `ingress.hosts`       | Ingress hosts and paths.                   | `[]`    |
| `ingress.tls`         | TLS configuration for HTTPS.               | `[]`    |

### Prometheus

| Name                                              | Description                                | Value                           |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------- |
| `prometheus.chartManaged`                         | Manage Prometheus via this chart.          | `true`                          |
| `prometheus.external.existingSecret`              | Existing secret with connection details.   | `""`                            |
| `prometheus.external.secretKeys.host`             | Secret key for host.                       | `""`                            |
| `prometheus.external.secretKeys.port`             | Secret key for port.                       | `""`                            |
| `prometheus.external.secretKeys.username`         | Secret key for username (optional).        | `""`                            |
| `prometheus.external.secretKeys.password`         | Secret key for password (optional).        | `""`                            |
| `prometheus.external.secretKeys.connectionString` | Secret key for connection string.          | `""`                            |
| `prometheus.alertmanager.enabled`                 | Enable Alertmanager.                       | `false`                         |
| `prometheus.kube-state-metrics.enabled`           | Enable kube-state-metrics sub-chart.       | `false`                         |
| `prometheus.prometheus-node-exporter.enabled`     | Enable node-exporter sub-chart.            | `false`                         |
| `prometheus.prometheus-pushgateway.enabled`       | Enable pushgateway sub-chart.              | `false`                         |
| `prometheus.rbac`                                 | RBAC settings for Prometheus.              |                                 |
| `prometheus.rbac.create`                          | Create RBAC resources.                     | `true`                          |
| `prometheus.serviceAccounts.server`               | ServiceAccount settings.                   |                                 |
| `prometheus.serviceAccounts.server.create`        | Create a dedicated ServiceAccount.         | `true`                          |
| `prometheus.server.configMapOverrideName`         | Override ConfigMap name for scrape config. | `prometheus-config`             |
| `prometheus.server.image`                         | Image configuration.                       |                                 |
| `prometheus.server.image.repository`              | Image repository.                          | `quay.io/prometheus/prometheus` |
| `prometheus.server.image.tag`                     | Image tag.                                 | `v3.2.1`                        |
| `prometheus.server.replicaCount`                  | Number of Prometheus replicas.             | `1`                             |
| `prometheus.server.global`                        | Global scrape/evaluation intervals.        |                                 |
| `prometheus.server.global.scrape_interval`        | Scrape interval.                           | `15s`                           |
| `prometheus.server.global.evaluation_interval`    | Evaluation interval.                       | `15s`                           |
| `prometheus.server.persistentVolume`              | Persistent storage configuration.          |                                 |
| `prometheus.server.persistentVolume.enabled`      | Enable persistence.                        | `true`                          |
| `prometheus.server.persistentVolume.size`         | PVC size.                                  | `6Gi`                           |
| `prometheus.server.persistentVolume.storageClass` | Storage class name.                        | `""`                            |
| `prometheus.server.retention`                     | Data retention period.                     | `60d`                           |
| `prometheus.server.resources`                     | Resource requests and limits.              |                                 |
| `prometheus.server.resources.requests.cpu`        | Requested CPU.                             | `200m`                          |
| `prometheus.server.resources.requests.memory`     | Requested memory.                          | `512Mi`                         |
| `prometheus.server.resources.limits.cpu`          | CPU limit.                                 | `500m`                          |
| `prometheus.server.resources.limits.memory`       | Memory limit.                              | `2Gi`                           |
| `prometheus.server.service`                       | Service configuration.                     |                                 |
| `prometheus.server.service.type`                  | Service type.                              | `ClusterIP`                     |
| `prometheus.server.service.servicePort`           | Service port.                              | `9090`                          |
| `prometheus.server.securityContext`               | Pod security context for Prometheus.       |                                 |
| `prometheus.server.securityContext.runAsNonRoot`  | Run as non-root user.                      | `true`                          |
| `prometheus.server.securityContext.runAsUser`     | User ID.                                   | `65534`                         |
| `prometheus.server.securityContext.fsGroup`       | FS group ID.                               | `65534`                         |

### PostgreSQL

| Name                                                | Description                                          | Value               |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------- |
| `postgresql.chartManaged`                           | Manage PostgreSQL via this chart.                    | `true`              |
| `postgresql.external.connectionString.value`        | External PostgreSQL connection string.               | `""`                |
| `postgresql.external.connectionString.secretKeyRef` | Secret ref for connection string.                    | `{}`                |
| `postgresql.auth.username`                          | Database username.                                   | `postgres`          |
| `postgresql.auth.password`                          | Database password (do not set inline in production). | `""`                |
| `postgresql.auth.database`                          | Database name.                                       | `langwatch`         |
| `postgresql.auth.existingSecret`                    | Existing secret for DB credentials.                  | `""`                |
| `postgresql.auth.secretKeys.usernameKey`            | Username key.                                        | `username`          |
| `postgresql.auth.secretKeys.adminPasswordKey`       | Admin password key.                                  | `postgres-password` |
| `postgresql.auth.secretKeys.passwordKey`            | Password key.                                        | `password`          |
| `postgresql.auth.secretKeys.databaseKey`            | Database key.                                        | `database`          |
| `postgresql.image`                                  | PostgreSQL container image.                          |                     |
| `postgresql.image.repository`                       | Image repository.                                    | `postgres`          |
| `postgresql.image.tag`                              | Image tag.                                           | `"17"`              |
| `postgresql.image.pullPolicy`                       | Image pull policy.                                   | `IfNotPresent`      |
| `postgresql.primary.persistence`                    | Persistent volume for primary.                       |                     |
| `postgresql.primary.persistence.size`               | PVC size.                                            | `20Gi`              |
| `postgresql.primary.persistence.storageClass`       | Storage class.                                       | `""`                |
| `postgresql.primary.resources`                      | Resource requests and limits.                        |                     |
| `postgresql.primary.resources.requests.cpu`         | Requested CPU.                                       | `250m`              |
| `postgresql.primary.resources.requests.memory`      | Requested memory.                                    | `512Mi`             |
| `postgresql.primary.resources.limits.cpu`           | CPU limit.                                           | `1000m`             |
| `postgresql.primary.resources.limits.memory`        | Memory limit.                                        | `1Gi`               |

### ClickHouse

| Name                                        | Description                                                                                   | Value   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| `clickhouse.chartManaged`                   | Manage ClickHouse via this chart using the clickhouse-serverless subchart (false = external). | `true`  |
| `clickhouse.external.url`                   | ClickHouse connection URL.                                                                    |         |
| `clickhouse.external.url.value`             | Full ClickHouse URL (http://user:pass@host:8123/database).                                    | `""`    |
| `clickhouse.external.url.secretKeyRef.name` | Secret name for URL.                                                                          | `""`    |
| `clickhouse.external.url.secretKeyRef.key`  | Secret key for URL.                                                                           | `""`    |
| `clickhouse.external.cluster`               | Cluster name for ON CLUSTER DDL (omit for non-replicated).                                    | `""`    |

### ClickHouse (chart-managed subchart options)

| Name                                                       | Description                                                                                                   | Value            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------- |
| `clickhouse.replicas`                                      | ClickHouse replicas. 1 = standalone MergeTree. 3+ = Keeper + ReplicatedMergeTree (must be odd).               | `1`              |
| `clickhouse.memory`                                        | Memory limit per ClickHouse pod. Image auto-tunes MAX_SERVER_MEMORY_USAGE (85%), per-query limits (20%), etc. | `4Gi`            |
| `clickhouse.cpu`                                           | CPU limit per ClickHouse pod. Image auto-tunes merge pool size, insert threads, etc.                          | `2`              |
| `clickhouse.storage`                                       | Hot storage configuration.                                                                                    |                  |
| `clickhouse.storage.size`                                  | PVC size for hot data.                                                                                        | `50Gi`           |
| `clickhouse.storage.storageClass`                          | Storage class (empty = cluster default).                                                                      | `""`             |
| `clickhouse.objectStorage.bucket`                          | S3 bucket name (shared by cold storage and backups).                                                          | `""`             |
| `clickhouse.objectStorage.region`                          | S3 region.                                                                                                    | `""`             |
| `clickhouse.objectStorage.endpoint`                        | S3-compatible endpoint URL.                                                                                   | `""`             |
| `clickhouse.objectStorage.useEnvironmentCredentials`       | Use IRSA / workload identity.                                                                                 | `true`           |
| `clickhouse.objectStorage.credentials.secretKeyRef.name`   | Secret name containing S3 access keys.                                                                        | `""`             |
| `clickhouse.cold.enabled`                                  | Enable tiered hot→cold storage to S3.                                                                         | `false`          |
| `clickhouse.cold.defaultTtlDays`                           | TTL days before data moves to cold (must be divisible by 7).                                                  | `49`             |
| `clickhouse.backup.enabled`                                | Enable automated native ClickHouse backups.                                                                   | `false`          |
| `clickhouse.backup.database`                               | Database to back up.                                                                                          | `langwatch`      |
| `clickhouse.backup.full.schedule`                          | Cron schedule for full backups.                                                                               | `"0 */12 * * *"` |
| `clickhouse.backup.incremental.schedule`                   | Cron schedule for incremental backups.                                                                        | `"0 * * * *"`    |
| `clickhouse.auth`                                          | Authentication configuration.                                                                                 |                  |
| `clickhouse.auth.password`                                 | ClickHouse password (auto-generated when empty).                                                              | `""`             |
| `clickhouse.auth.existingSecret`                           | Name of existing secret containing the password.                                                              | `""`             |
| `clickhouse.auth.secretKeys`                               | Key mappings for existing secret.                                                                             |                  |
| `clickhouse.auth.secretKeys.passwordKey`                   | Key name in the existing secret.                                                                              | `password`       |
| `clickhouse.env`                                           | Advanced: override any computed ClickHouse env var (applied last).                                            | `{}`             |
| `clickhouse.scheduling`                                    | Scheduling constraints for ClickHouse pods.                                                                   |                  |
| `clickhouse.scheduling.nodeSelector`                       | Node selector for ClickHouse pods.                                                                            | `{}`             |
| `clickhouse.scheduling.affinity`                           | Affinity rules for ClickHouse pods.                                                                           | `{}`             |
| `clickhouse.scheduling.tolerations`                        | Tolerations for ClickHouse pods.                                                                              | `[]`             |

### Redis

| Name                                           | Description                                                 | Value          |
| ---------------------------------------------- | ----------------------------------------------------------- | -------------- |
| `redis.chartManaged`                           | Manage Redis via this chart.                                | `true`         |
| `redis.external.architecture`                  | Redis architecture for external mode.                       | `standalone`   |
| `redis.external.connectionString.value`        | Redis connection string URL.                                | `""`           |
| `redis.external.connectionString.secretKeyRef` | Secret ref for connection string.                           | `{}`           |
| `redis.image`                                  | Redis container image.                                      |                |
| `redis.image.repository`                       | Image repository.                                           | `redis`        |
| `redis.image.tag`                              | Image tag.                                                  | `"8"`          |
| `redis.image.pullPolicy`                       | Image pull policy.                                          | `IfNotPresent` |
| `redis.auth.enabled`                           | Enable Redis AUTH.                                          | `true`         |
| `redis.auth.password`                          | Redis password (autogenerated if empty when chart-managed). | `""`           |
| `redis.auth.existingSecret`                    | Existing secret for Redis password.                         | `""`           |
| `redis.auth.secretKeys.passwordKey`            | Password key name.                                          | `password`     |
| `redis.master.persistence`                     | Persistent volume for master.                               |                |
| `redis.master.persistence.enabled`             | Enable persistence.                                         | `true`         |
| `redis.master.persistence.size`                | PVC size.                                                   | `10Gi`         |
| `redis.master.persistence.storageClass`        | Storage class.                                              | `""`           |
| `redis.master.resources`                       | Resource requests and limits.                               |                |
| `redis.master.resources.requests.cpu`          | Requested CPU.                                              | `250m`         |
| `redis.master.resources.requests.memory`       | Requested memory.                                           | `256Mi`        |
| `redis.master.resources.limits.cpu`            | CPU limit.                                                  | `500m`         |
| `redis.master.resources.limits.memory`         | Memory limit.                                               | `512Mi`        |

_This section will be replaced by the generator._


