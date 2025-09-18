## LangWatch Helm Chart

Deploy LangWatch to Kubernetes using this Helm chart. It includes the LangWatch web app, NLP service, Langevals service, and optional system dependencies (PostgreSQL, Redis, OpenSearch, Prometheus).

### Prerequisites

- Kubernetes 1.24+
- Helm 3.12+
- A default StorageClass for persistent components (PostgreSQL, Redis, OpenSearch) if enabled

### Install (from this repo)

```bash
helm install langwatch ./charts/langwatch \
  --namespace langwatch --create-namespace
```

### Install with your values

Create a values file (for example `my-values.yaml`) and set required fields:

```yaml
# Example: base URLs
app:
  http:
    publicUrl: https://langwatch.example.com

# Example: use secrets via secretKeyRef pattern
app:
  credentialsEncryptionKey:
    secretKeyRef:
      name: langwatch-secrets
      key: credentialsEncryptionKey
  cronApiKey:
    secretKeyRef:
      name: langwatch-secrets
      key: cronApiKey

# Optional: enable managed dependencies
postgresql:
  chartManaged: true
redis:
  chartManaged: true
opensearch:
  chartManaged: true
prometheus:
  chartManaged: true
```

Then install:

```bash
helm install langwatch ./charts/langwatch \
  --namespace langwatch --create-namespace \
  -f my-values.yaml
```

### Complete install guide

For a complete installation guide and more detailed information, please visit our [documentation](https://docs.langwatch.ai/self-hosting/kubernetes-helm).

### Upgrade

```bash
helm upgrade langwatch ./charts/langwatch \
  --namespace langwatch \
  -f my-values.yaml
```

### Important: Migration from Pre-1.0.0 Helm Charts

> If you're upgrading from a LangWatch Helm chart version before 1.0.0, you may need to preserve your existing PostgreSQL data.

Preserve existing data by setting `postgresql.primary.persistence.existingClaim` in your values file:

```yaml
postgresql:
  primary:
    persistence:
      existingClaim: "data-langwatch-postgres-0"
      size: 20Gi
```

This will prevent data loss during the upgrade process.

### Uninstall

```bash
helm uninstall langwatch --namespace langwatch
```

### Secrets pattern (recommended)

Wherever a setting supports secrets, use the `secretKeyRef` block to reference an existing `Secret` instead of inlining sensitive values.

```yaml
app:
  nextAuth:
    secret:
      secretKeyRef:
        name: langwatch-secrets
        key: nextAuthSecret
```

Corresponding Secret example:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: langwatch-secrets
  namespace: langwatch
type: Opaque
stringData:
  credentialsEncryptionKey: "change-me"
  cronApiKey: "change-me"
  nextAuthSecret: "change-me"
  sendgridApiKey: "change-me"
```

### Optional components

- PostgreSQL: `postgresql.chartManaged: true` to deploy in-cluster, or set `postgresql.external.connectionString` via `secretKeyRef` to use an external DB
- Redis: `redis.chartManaged: true` for in-cluster, or configure `redis.external.connectionString` for external
- OpenSearch: `opensearch.chartManaged: true` for in-cluster, or configure `opensearch.external.nodeUrl`/`apiKey` for external engines
- Prometheus: `prometheus.chartManaged: true` to deploy a local Prometheus server

### Regenerate this table

The Parameters section below is auto-generated from `values.yaml` using Bitnami's README generator for Helm charts. To update it after changing values/metadata:

```bash
npx @bitnami/readme-generator-for-helm --readme ./README.md --values values.yaml
```

Learn more: `https://github.com/bitnami/readme-generator-for-helm`

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

| Name                                                                    | Description                                                       | Value                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| `app.replicaCount`                                                      | Number of application replicas.                                   | `1`                     |
| `app.service`                                                           | Service configuration for the app.                                |                         |
| `app.service.type`                                                      | Service type.                                                     | `ClusterIP`             |
| `app.service.port`                                                      | Service port.                                                     | `5560`                  |
| `app.resources`                                                         | Resource requests and limits for the app.                         |                         |
| `app.resources.requests.cpu`                                            | Requested CPU.                                                    | `250m`                  |
| `app.resources.requests.memory`                                         | Requested memory.                                                 | `2Gi`                   |
| `app.resources.limits.cpu`                                              | CPU limit.                                                        | `1000m`                 |
| `app.resources.limits.memory`                                           | Memory limit.                                                     | `4Gi`                   |
| `app.nodeEnv`                                                           | Node.js environment override (falls back to global.env if empty). | `""`                    |
| `app.credentialsEncryptionKey`                                          | Configuration for credentials encryption.                         |                         |
| `app.credentialsEncryptionKey.value`                                    | Encryption key value (not recommended in production).             | `""`                    |
| `app.credentialsEncryptionKey.secretKeyRef`                             | Reference to a secret holding the encryption key.                 | `{}`                    |
| `app.cronApiKey`                                                        | API key used by cron jobs for authentication.                     |                         |
| `app.cronApiKey.value`                                                  | Cron API key value.                                               | `""`                    |
| `app.cronApiKey.secretKeyRef`                                           | Reference to a secret holding the cron API key.                   | `{}`                    |
| `app.http`                                                              | HTTP configuration for base/public URLs.                          |                         |
| `app.http.baseHost`                                                     | Internal base URL.                                                | `http://localhost:5560` |
| `app.http.publicUrl`                                                    | Public URL for users.                                             | `http://localhost:5560` |
| `app.features`                                                          | Feature flags for the app.                                        |                         |
| `app.features.skipEnvValidation`                                        | Skip env var validation (dev only).                               | `false`                 |
| `app.features.disablePiiRedaction`                                      | Disable PII redaction.                                            | `false`                 |
| `app.features.topicClustering`                                          | Enable automatic topic clustering.                                | `true`                  |
| `app.upstreams`                                                         | Upstream connections from app to internal services.               |                         |
| `app.upstreams.nlp.scheme`                                              | Scheme for NLP upstream.                                          | `http`                  |
| `app.upstreams.nlp.name`                                                | Service name for NLP upstream.                                    | `langwatch-nlp`         |
| `app.upstreams.nlp.port`                                                | Port for NLP upstream.                                            | `5561`                  |
| `app.upstreams.langevals.schema`                                        | Scheme for Langevals upstream.                                    | `http`                  |
| `app.upstreams.langevals.name`                                          | Service name for Langevals upstream.                              | `langevals`             |
| `app.upstreams.langevals.port`                                          | Port for Langevals upstream.                                      | `5562`                  |
| `app.evaluators`                                                        | Evaluator providers configuration.                                |                         |
| `app.evaluators.azureOpenAI`                                            | Azure OpenAI evaluator configuration.                             |                         |
| `app.evaluators.azureOpenAI.enabled`                                    | Enable Azure OpenAI evaluator.                                    | `false`                 |
| `app.evaluators.azureOpenAI.endpoint.value`                             | Azure OpenAI endpoint.                                            | `""`                    |
| `app.evaluators.azureOpenAI.apiKey.value`                               | Azure OpenAI API key.                                             | `""`                    |
| `app.evaluators.azureOpenAI.endpoint.secretKeyRef`                      | Secret ref for Azure OpenAI endpoint.                             | `{}`                    |
| `app.evaluators.azureOpenAI.apiKey.secretKeyRef`                        | Secret ref for Azure OpenAI API key.                              | `{}`                    |
| `app.evaluators.google`                                                 | Google evaluator configuration.                                   |                         |
| `app.evaluators.google.enabled`                                         | Enable Google evaluator.                                          | `false`                 |
| `app.evaluators.google.credentials.value`                               | Google credentials JSON (base64 or inline).                       | `""`                    |
| `app.evaluators.google.credentials.secretKeyRef`                        | Secret ref for Google credentials JSON.                           | `{}`                    |
| `app.datasetObjectStorage`                                              | Object storage configuration for datasets.                        |                         |
| `app.datasetObjectStorage.enabled`                                      | Enable dataset object storage.                                    | `false`                 |
| `app.datasetObjectStorage.provider`                                     | Object storage provider.                                          | `awsS3`                 |
| `app.datasetObjectStorage.bucket`                                       | Bucket name for datasets.                                         | `langwatch-dataset`     |
| `app.datasetObjectStorage.providers.awsS3`                              | AWS S3 provider configuration.                                    |                         |
| `app.datasetObjectStorage.providers.awsS3.endpoint.value`               | Custom S3 endpoint.                                               | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.accessKeyId.value`            | S3 access key ID.                                                 | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.secretAccessKey.value`        | S3 secret access key.                                             | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.keySalt.value`                | Optional key salt.                                                | `""`                    |
| `app.datasetObjectStorage.providers.awsS3.endpoint.secretKeyRef`        | Secret ref for custom S3 endpoint.                                | `{}`                    |
| `app.datasetObjectStorage.providers.awsS3.accessKeyId.secretKeyRef`     | Secret ref for S3 access key ID.                                  | `{}`                    |
| `app.datasetObjectStorage.providers.awsS3.secretAccessKey.secretKeyRef` | Secret ref for S3 secret access key.                              | `{}`                    |
| `app.datasetObjectStorage.providers.awsS3.keySalt.secretKeyRef`         | Secret ref for optional key salt.                                 | `{}`                    |
| `app.email`                                                             | Email provider configuration.                                     |                         |
| `app.email.enabled`                                                     | Enable email notifications.                                       | `false`                 |
| `app.email.defaultFrom`                                                 | Default "from" address.                                           | `""`                    |
| `app.email.provider`                                                    | Email provider.                                                   | `sendgrid`              |
| `app.email.providers.sendgrid`                                          | Sendgrid provider configuration.                                  |                         |
| `app.email.providers.sendgrid.apiKey.value`                             | Sendgrid API key.                                                 | `""`                    |
| `app.email.providers.sendgrid.apiKey.secretKeyRef`                      | Secret ref for SendGrid API key.                                  | `{}`                    |
| `app.nextAuth`                                                          | NextAuth configuration and providers.                             |                         |
| `app.nextAuth.provider`                                                 | Default auth provider.                                            | `email`                 |
| `app.nextAuth.secret.value`                                             | NextAuth secret value (not recommended inline for production).    | `""`                    |
| `app.nextAuth.secret.secretKeyRef`                                      | Secret ref for NextAuth secret.                                   | `{}`                    |
| `app.nextAuth.providers`                                                | OAuth providers configuration.                                    |                         |
| `app.nextAuth.providers.auth0`                                          | Auth0 OAuth configuration.                                        |                         |
| `app.nextAuth.providers.auth0.clientId.value`                           | Auth0 client ID.                                                  | `""`                    |
| `app.nextAuth.providers.auth0.clientSecret.value`                       | Auth0 client secret.                                              | `""`                    |
| `app.nextAuth.providers.auth0.issuer.value`                             | Auth0 issuer URL.                                                 | `""`                    |
| `app.nextAuth.providers.auth0.clientId.value`                           | Auth0 client ID.                                                  | `""`                    |
| `app.nextAuth.providers.auth0.clientId.secretKeyRef`                    | Secret ref for Auth0 client ID.                                   | `{}`                    |
| `app.nextAuth.providers.auth0.clientSecret.value`                       | Auth0 client secret.                                              | `""`                    |
| `app.nextAuth.providers.auth0.clientSecret.secretKeyRef`                | Secret ref for Auth0 client secret.                               | `{}`                    |
| `app.nextAuth.providers.auth0.issuer.value`                             | Auth0 issuer URL.                                                 | `""`                    |
| `app.nextAuth.providers.auth0.issuer.secretKeyRef`                      | Secret ref for Auth0 issuer URL.                                  | `{}`                    |
| `app.nextAuth.providers.azureAd`                                        | Azure AD OAuth configuration.                                     |                         |
| `app.nextAuth.providers.azureAd.clientId.value`                         | Azure AD client ID.                                               | `""`                    |
| `app.nextAuth.providers.azureAd.clientId.secretKeyRef`                  | Secret ref for Azure AD client ID.                                | `{}`                    |
| `app.nextAuth.providers.azureAd.clientSecret.value`                     | Azure AD client secret.                                           | `""`                    |
| `app.nextAuth.providers.azureAd.clientSecret.secretKeyRef`              | Secret ref for Azure AD client secret.                            | `{}`                    |
| `app.nextAuth.providers.azureAd.tenantId.value`                         | Azure AD tenant ID.                                               | `""`                    |
| `app.nextAuth.providers.azureAd.tenantId.secretKeyRef`                  | Secret ref for Azure AD tenant ID.                                | `{}`                    |
| `app.nextAuth.providers.cognito`                                        | AWS Cognito OAuth configuration.                                  |                         |
| `app.nextAuth.providers.cognito.clientId.value`                         | Cognito client ID.                                                | `""`                    |
| `app.nextAuth.providers.cognito.clientId.secretKeyRef`                  | Secret ref for Cognito client ID.                                 | `{}`                    |
| `app.nextAuth.providers.cognito.clientSecret.value`                     | Cognito client secret.                                            | `""`                    |
| `app.nextAuth.providers.cognito.clientSecret.secretKeyRef`              | Secret ref for Cognito client secret.                             | `{}`                    |
| `app.nextAuth.providers.cognito.issuer.value`                           | Cognito issuer URL.                                               | `""`                    |
| `app.nextAuth.providers.cognito.issuer.secretKeyRef`                    | Secret ref for Cognito issuer URL.                                | `{}`                    |
| `app.nextAuth.providers.github`                                         | GitHub OAuth configuration.                                       |                         |
| `app.nextAuth.providers.github.clientId.value`                          | GitHub client ID.                                                 | `""`                    |
| `app.nextAuth.providers.github.clientId.secretKeyRef`                   | Secret ref for GitHub client ID.                                  | `{}`                    |
| `app.nextAuth.providers.github.clientSecret.value`                      | GitHub client secret.                                             | `""`                    |
| `app.nextAuth.providers.github.clientSecret.secretKeyRef`               | Secret ref for GitHub client secret.                              | `{}`                    |
| `app.nextAuth.providers.gitlab`                                         | GitLab OAuth configuration.                                       |                         |
| `app.nextAuth.providers.gitlab.clientId.value`                          | GitLab client ID.                                                 | `""`                    |
| `app.nextAuth.providers.gitlab.clientId.secretKeyRef`                   | Secret ref for GitLab client ID.                                  | `{}`                    |
| `app.nextAuth.providers.gitlab.clientSecret.value`                      | GitLab client secret.                                             | `""`                    |
| `app.nextAuth.providers.gitlab.clientSecret.secretKeyRef`               | Secret ref for GitLab client secret.                              | `{}`                    |
| `app.nextAuth.providers.google`                                         | Google OAuth configuration.                                       |                         |
| `app.nextAuth.providers.google.clientId.value`                          | Google client ID.                                                 | `""`                    |
| `app.nextAuth.providers.google.clientId.secretKeyRef`                   | Secret ref for Google client ID.                                  | `{}`                    |
| `app.nextAuth.providers.google.clientSecret.value`                      | Google client secret.                                             | `""`                    |
| `app.nextAuth.providers.google.clientSecret.secretKeyRef`               | Secret ref for Google client secret.                              | `{}`                    |
| `app.nextAuth.providers.okta`                                           | Okta OAuth configuration.                                         |                         |
| `app.nextAuth.providers.okta.clientId.value`                            | Okta client ID.                                                   | `""`                    |
| `app.nextAuth.providers.okta.clientId.secretKeyRef`                     | Secret ref for Okta client ID.                                    | `{}`                    |
| `app.nextAuth.providers.okta.clientSecret.value`                        | Okta client secret.                                               | `""`                    |
| `app.nextAuth.providers.okta.clientSecret.secretKeyRef`                 | Secret ref for Okta client secret.                                | `{}`                    |
| `app.nextAuth.providers.okta.issuer.value`                              | Okta issuer URL.                                                  | `""`                    |
| `app.nextAuth.providers.okta.issuer.secretKeyRef`                       | Secret ref for Okta issuer URL.                                   | `{}`                    |
| `app.telemetry`                                                         | Telemetry configuration.                                          |                         |
| `app.telemetry.usage`                                                   | Usage analytics.                                                  |                         |
| `app.telemetry.usage.enabled`                                           | Enable anonymous usage analytics.                                 | `true`                  |
| `app.telemetry.metrics`                                                 | Metrics configuration.                                            |                         |
| `app.telemetry.metrics.enabled`                                         | Enable metrics collection.                                        | `false`                 |
| `app.telemetry.metrics.apiKey.value`                                    | Metrics API key.                                                  | `""`                    |
| `app.telemetry.metrics.apiKey.secretKeyRef`                             | Secret ref for metrics API key.                                   | `{}`                    |
| `app.telemetry.sentry`                                                  | Sentry error reporting.                                           |                         |
| `app.telemetry.sentry.enabled`                                          | Enable Sentry error reporting.                                    | `false`                 |
| `app.telemetry.sentry.dsn.value`                                        | Sentry DSN.                                                       | `""`                    |
| `app.telemetry.sentry.dsn.secretKeyRef`                                 | Secret ref for Sentry DSN.                                        | `{}`                    |

### CronJobs Kubernetes overrides


### Langevals Kubernetes overrides


### NLP Kubernetes overrides


### App Kubernetes overrides

| Name                            | Description                                         | Value |
| ------------------------------- | --------------------------------------------------- | ----- |
| `app.podSecurityContext`        | Pod security context overrides for app.             | `{}`  |
| `app.containerSecurityContext`  | Container security context overrides for app.       | `{}`  |
| `app.podDisruptionBudget`       | PodDisruptionBudget spec overrides.                 | `{}`  |
| `app.nodeSelector`              | Node selector overrides.                            | `{}`  |
| `app.tolerations`               | Tolerations overrides.                              | `[]`  |
| `app.affinity`                  | Affinity overrides.                                 | `{}`  |
| `app.topologySpreadConstraints` | Topology spread constraints.                        | `[]`  |
| `app.pod`                       | Pod-level metadata.                                 |       |
| `app.pod.annotations`           | Additional pod annotations.                         | `{}`  |
| `app.pod.labels`                | Additional pod labels.                              | `{}`  |
| `app.deployment`                | Deployment-level metadata and strategy.             |       |
| `app.deployment.annotations`    | Additional deployment annotations.                  | `{}`  |
| `app.deployment.labels`         | Additional deployment labels.                       | `{}`  |
| `app.deployment.strategy`       | Deployment strategy overrides.                      | `{}`  |
| `app.revisionHistoryLimit`      | Number of old replicasets to retain.                | `10`  |
| `app.extraEnvs`                 | Additional environment variables for app container. | `[]`  |
| `app.extraContainers`           | Additional sidecar containers.                      | `[]`  |
| `app.extraVolumes`              | Additional pod volumes.                             | `[]`  |
| `app.extraInitContainers`       | Additional init containers.                         | `[]`  |
| `app.extraAppLifecycle`         | Additional lifecycle hooks for app container.       | `{}`  |
| `app.extraAppVolumeMounts`      | Additional volume mounts for app container.         | `[]`  |

### NLP service

| Name                                       | Description                                   | Value           |
| ------------------------------------------ | --------------------------------------------- | --------------- |
| `langwatch_nlp.replicaCount`               | Number of NLP service replicas.               | `1`             |
| `langwatch_nlp.service`                    | Service configuration for NLP.                |                 |
| `langwatch_nlp.service.type`               | Service type.                                 | `ClusterIP`     |
| `langwatch_nlp.service.port`               | Service port.                                 | `5561`          |
| `langwatch_nlp.resources`                  | Resource requests and limits.                 |                 |
| `langwatch_nlp.resources.requests.cpu`     | Requested CPU.                                | `1000m`         |
| `langwatch_nlp.resources.requests.memory`  | Requested memory.                             | `2Gi`           |
| `langwatch_nlp.resources.limits.cpu`       | CPU limit.                                    | `2000m`         |
| `langwatch_nlp.resources.limits.memory`    | Memory limit.                                 | `4Gi`           |
| `langwatch_nlp.upstreams`                  | Upstream to app (callbacks, etc.).            |                 |
| `langwatch_nlp.upstreams.langwatch.scheme` | Scheme to app.                                | `http`          |
| `langwatch_nlp.upstreams.langwatch.name`   | Service name for app.                         | `langwatch-app` |
| `langwatch_nlp.upstreams.langwatch.port`   | Port to app.                                  | `5560`          |
| `langwatch_nlp.podSecurityContext`         | Pod security context overrides.               | `{}`            |
| `langwatch_nlp.containerSecurityContext`   | Container security context overrides.         | `{}`            |
| `langwatch_nlp.podDisruptionBudget`        | PodDisruptionBudget spec overrides.           | `{}`            |
| `langwatch_nlp.nodeSelector`               | Node selector overrides.                      | `{}`            |
| `langwatch_nlp.tolerations`                | Tolerations overrides.                        | `[]`            |
| `langwatch_nlp.affinity`                   | Affinity overrides.                           | `{}`            |
| `langwatch_nlp.topologySpreadConstraints`  | Topology spread constraints.                  | `[]`            |
| `langwatch_nlp.pod`                        | Pod-level metadata.                           |                 |
| `langwatch_nlp.pod.annotations`            | Additional pod annotations.                   | `{}`            |
| `langwatch_nlp.pod.labels`                 | Additional pod labels.                        | `{}`            |
| `langwatch_nlp.deployment`                 | Deployment-level metadata and strategy.       |                 |
| `langwatch_nlp.deployment.annotations`     | Additional deployment annotations.            | `{}`            |
| `langwatch_nlp.deployment.labels`          | Additional deployment labels.                 | `{}`            |
| `langwatch_nlp.deployment.strategy`        | Deployment strategy overrides.                | `{}`            |
| `langwatch_nlp.revisionHistoryLimit`       | Number of old replicasets to retain.          | `10`            |
| `langwatch_nlp.extraEnvs`                  | Additional environment variables.             | `[]`            |
| `langwatch_nlp.extraContainers`            | Additional sidecar containers.                | `[]`            |
| `langwatch_nlp.extraVolumes`               | Additional pod volumes.                       | `[]`            |
| `langwatch_nlp.extraInitContainers`        | Additional init containers.                   | `[]`            |
| `langwatch_nlp.extraNlpLifecycle`          | Additional lifecycle hooks for NLP container. | `{}`            |
| `langwatch_nlp.extraNlpVolumeMounts`       | Additional volume mounts for NLP container.   | `[]`            |

### Langevals service

| Name                                   | Description                             | Value       |
| -------------------------------------- | --------------------------------------- | ----------- |
| `langevals.replicaCount`               | Number of Langevals replicas.           | `1`         |
| `langevals.service`                    | Service configuration for Langevals.    |             |
| `langevals.service.type`               | Service type.                           | `ClusterIP` |
| `langevals.service.port`               | Service port.                           | `5562`      |
| `langevals.resources`                  | Resource requests and limits.           |             |
| `langevals.resources.requests.cpu`     | Requested CPU.                          | `1000m`     |
| `langevals.resources.requests.memory`  | Requested memory.                       | `6Gi`       |
| `langevals.resources.limits.cpu`       | CPU limit.                              | `2000m`     |
| `langevals.resources.limits.memory`    | Memory limit.                           | `8Gi`       |
| `langevals.podSecurityContext`         | Pod security context overrides.         | `{}`        |
| `langevals.containerSecurityContext`   | Container security context overrides.   | `{}`        |
| `langevals.podDisruptionBudget`        | PodDisruptionBudget spec overrides.     | `{}`        |
| `langevals.nodeSelector`               | Node selector overrides.                | `{}`        |
| `langevals.tolerations`                | Tolerations overrides.                  | `[]`        |
| `langevals.affinity`                   | Affinity overrides.                     | `{}`        |
| `langevals.topologySpreadConstraints`  | Topology spread constraints.            | `[]`        |
| `langevals.pod`                        | Pod-level metadata.                     |             |
| `langevals.pod.annotations`            | Additional pod annotations.             | `{}`        |
| `langevals.pod.labels`                 | Additional pod labels.                  | `{}`        |
| `langevals.deployment`                 | Deployment-level metadata and strategy. |             |
| `langevals.deployment.annotations`     | Additional deployment annotations.      | `{}`        |
| `langevals.deployment.labels`          | Additional deployment labels.           | `{}`        |
| `langevals.deployment.strategy`        | Deployment strategy overrides.          | `{}`        |
| `langevals.revisionHistoryLimit`       | Number of old replicasets to retain.    | `10`        |
| `langevals.extraEnvs`                  | Additional environment variables.       | `[]`        |
| `langevals.extraContainers`            | Additional sidecar containers.          | `[]`        |
| `langevals.extraVolumes`               | Additional pod volumes.                 | `[]`        |
| `langevals.extraInitContainers`        | Additional init containers.             | `[]`        |
| `langevals.extraLangevalsLifecycle`    | Additional lifecycle hooks.             | `{}`        |
| `langevals.extraLangevalsVolumeMounts` | Additional volume mounts.               | `[]`        |

### CronJobs

| Name                                            | Description                                        | Value                                       |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| `cronjobs.enabled`                              | Enable all cron jobs.                              | `true`                                      |
| `cronjobs.image`                                | Cron job image.                                    |                                             |
| `cronjobs.image.repository`                     | Image repository.                                  | `curlimages/curl`                           |
| `cronjobs.image.tag`                            | Image tag.                                         | `latest`                                    |
| `cronjobs.image.pullPolicy`                     | Image pull policy.                                 | `IfNotPresent`                              |
| `cronjobs.resources`                            | Resource requests and limits for jobs.             |                                             |
| `cronjobs.resources.requests.cpu`               | Requested CPU.                                     | `100m`                                      |
| `cronjobs.resources.requests.memory`            | Requested memory.                                  | `64Mi`                                      |
| `cronjobs.resources.limits.cpu`                 | CPU limit.                                         | `100m`                                      |
| `cronjobs.resources.limits.memory`              | Memory limit.                                      | `64Mi`                                      |
| `cronjobs.upstreams`                            | Upstream to app for cron endpoints.                |                                             |
| `cronjobs.upstreams.langwatch.name`             | App service name.                                  | `langwatch-app`                             |
| `cronjobs.upstreams.langwatch.port`             | App service port.                                  | `5560`                                      |
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
| `cronjobs.podDisruptionBudget`                  | PodDisruptionBudget spec overrides.                | `{}`                                        |
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

### Ingress

| Name                  | Description                                | Value   |
| --------------------- | ------------------------------------------ | ------- |
| `ingress.enabled`     | Enable ingress.                            | `false` |
| `ingress.className`   | Ingress class name (e.g., nginx, traefik). | `""`    |
| `ingress.annotations` | Additional ingress annotations.            | `{}`    |
| `ingress.hosts`       | Ingress hosts and paths.                   | `[]`    |
| `ingress.tls`         | TLS configuration for HTTPS.               | `[]`    |

### Prometheus

| Name                                              | Description                                | Value       |
| ------------------------------------------------- | ------------------------------------------ | ----------- |
| `prometheus.chartManaged`                         | Manage Prometheus via this chart.          | `true`      |
| `prometheus.external.existingSecret`              | Existing secret with connection details.   | `""`        |
| `prometheus.external.secretKeys.host`             | Secret key for host.                       | `""`        |
| `prometheus.external.secretKeys.port`             | Secret key for port.                       | `""`        |
| `prometheus.external.secretKeys.username`         | Secret key for username (optional).        | `""`        |
| `prometheus.external.secretKeys.password`         | Secret key for password (optional).        | `""`        |
| `prometheus.external.secretKeys.connectionString` | Secret key for connection string.          | `""`        |
| `prometheus.alertmanager.enabled`                 | Enable Alertmanager.                       | `false`     |
| `prometheus.pushgateway.enabled`                  | Enable Pushgateway.                        | `false`     |
| `prometheus.server.replicaCount`                  | Number of Prometheus replicas.             | `1`         |
| `prometheus.server.global`                        | Global scrape/evaluation intervals.        |             |
| `prometheus.server.global.scrape_interval`        | Scrape interval.                           | `15s`       |
| `prometheus.server.global.evaluation_interval`    | Evaluation interval.                       | `15s`       |
| `prometheus.server.persistence`                   | Persistent storage configuration.          |             |
| `prometheus.server.persistence.enabled`           | Enable persistence.                        | `true`      |
| `prometheus.server.persistence.size`              | PVC size.                                  | `6Gi`       |
| `prometheus.server.persistence.storageClass`      | Storage class name.                        | `""`        |
| `prometheus.server.retention`                     | Data retention period.                     | `60d`       |
| `prometheus.server.resources`                     | Resource requests and limits.              |             |
| `prometheus.server.resources.requests.cpu`        | Requested CPU.                             | `200m`      |
| `prometheus.server.resources.requests.memory`     | Requested memory.                          | `512Mi`     |
| `prometheus.server.resources.limits.cpu`          | CPU limit.                                 | `500m`      |
| `prometheus.server.resources.limits.memory`       | Memory limit.                              | `2Gi`       |
| `prometheus.server.rbac`                          | RBAC settings for Prometheus.              |             |
| `prometheus.server.rbac.create`                   | Create RBAC resources.                     | `true`      |
| `prometheus.server.rbac.includeDefaultRules`      | Include default RBAC rules.                | `true`      |
| `prometheus.server.serviceAccount`                | ServiceAccount settings.                   |             |
| `prometheus.server.serviceAccount.create`         | Create a dedicated ServiceAccount.         | `true`      |
| `prometheus.server.service`                       | Service configuration.                     |             |
| `prometheus.server.service.type`                  | Service type.                              | `ClusterIP` |
| `prometheus.server.service.port`                  | Service port.                              | `9090`      |
| `prometheus.server.securityContext`               | Security context for Prometheus container. |             |
| `prometheus.server.securityContext.runAsNonRoot`  | Run as non-root user.                      | `true`      |
| `prometheus.server.securityContext.runAsUser`     | User ID.                                   | `65534`     |
| `prometheus.server.securityContext.fsGroup`       | FS group ID.                               | `65534`     |

### PostgreSQL

| Name                                                    | Description                                          | Value                             |
| ------------------------------------------------------- | ---------------------------------------------------- | --------------------------------- |
| `postgresql.chartManaged`                               | Manage PostgreSQL via this chart.                    | `true`                            |
| `postgresql.external.connectionString.value`            | External PostgreSQL connection string.               | `""`                              |
| `postgresql.external.connectionString.secretKeyRef`     | Secret ref for connection string.                    | `{}`                              |
| `postgresql.auth.username`                              | Database username.                                   | `postgres`                        |
| `postgresql.auth.password`                              | Database password (do not set inline in production). | `""`                              |
| `postgresql.auth.database`                              | Database name.                                       | `mydb`                            |
| `postgresql.auth.existingSecret`                        | Existing secret for DB credentials.                  | `""`                              |
| `postgresql.auth.secretKeys.usernameKey`                | Username key.                                        | `username`                        |
| `postgresql.auth.secretKeys.adminPasswordKey`           | Admin password key.                                  | `postgres-password`               |
| `postgresql.auth.secretKeys.passwordKey`                | Password key.                                        | `password`                        |
| `postgresql.auth.secretKeys.databaseKey`                | Database key.                                        | `database`                        |
| `postgresql.image.tag`                                  | PostgreSQL image tag.                                | `16.6.0-debian-12-r2`             |
| `postgresql.postgresqlDataDir`                          | Data dir path.                                       | `/var/lib/postgresql/data/pgdata` |
| `postgresql.volumePermissions.enabled`                  | Enable volume permissions init.                      | `true`                            |
| `postgresql.primary.persistence`                        | Persistent volume for primary.                       |                                   |
| `postgresql.primary.persistence.enabled`                | Enable persistence.                                  | `true`                            |
| `postgresql.primary.persistence.mountPath`              | Mount path.                                          | `/var/lib/postgresql/data`        |
| `postgresql.primary.persistence.size`                   | PVC size.                                            | `20Gi`                            |
| `postgresql.primary.persistence.storageClass`           | Storage class.                                       | `""`                              |
| `postgresql.primary.persistence.readinessProbe`         | Readiness probe toggle.                              |                                   |
| `postgresql.primary.persistence.readinessProbe.enabled` | Enable readiness probe.                              | `true`                            |
| `postgresql.primary.persistence.livenessProbe`          | Liveness probe toggle.                               |                                   |
| `postgresql.primary.persistence.livenessProbe.enabled`  | Enable liveness probe.                               | `true`                            |
| `postgresql.resources`                                  | Resource requests and limits.                        |                                   |
| `postgresql.resources.requests.cpu`                     | Requested CPU.                                       | `250m`                            |
| `postgresql.resources.requests.memory`                  | Requested memory.                                    | `512Mi`                           |
| `postgresql.resources.limits.cpu`                       | CPU limit.                                           | `1000m`                           |
| `postgresql.resources.limits.memory`                    | Memory limit.                                        | `1Gi`                             |

### OpenSearch

| Name                                          | Description                                                 | Value            |
| --------------------------------------------- | ----------------------------------------------------------- | ---------------- |
| `opensearch.chartManaged`                     | Manage OpenSearch via this chart.                           | `true`           |
| `opensearch.external.engine`                  | Search engine type (opensearch|elasticsearch|quickwit).     | `opensearch`     |
| `opensearch.external.nodeUrl.value`           | External engine node URL.                                   | `""`             |
| `opensearch.external.nodeUrl.secretKeyRef`    | Secret ref for external engine node URL.                    | `{}`             |
| `opensearch.external.apiKey.value`            | API key for external engine.                                | `""`             |
| `opensearch.external.apiKey.secretKeyRef`     | Secret ref for external engine API key.                     | `{}`             |
| `opensearch.auth.adminPassword`               | Admin password (autogenerated if empty when chart-managed). | `""`             |
| `opensearch.auth.existingSecret`              | Existing secret for admin credentials.                      | `""`             |
| `opensearch.auth.secretKeys.adminPasswordKey` | Password key name.                                          | `admin-password` |
| `opensearch.replicas`                         | Number of OpenSearch replicas.                              | `1`              |
| `opensearch.config`                           | OpenSearch config file content.                             |                  |
| `opensearch.config.opensearch.yml`            | Contents of opensearch.yml.                                 | `""`             |
| `opensearch.extraEnvs`                        | Additional environment variables.                           |                  |
| `opensearch.persistence`                      | Persistent storage configuration.                           |                  |
| `opensearch.persistence.enabled`              | Enable persistence.                                         | `true`           |
| `opensearch.persistence.size`                 | PVC size.                                                   | `20Gi`           |
| `opensearch.persistence.accessModes`          | ] Access modes.                                             | `""`             |
| `opensearch.resources`                        | Resource requests and limits.                               |                  |
| `opensearch.resources.requests.cpu`           | Requested CPU.                                              | `1000m`          |
| `opensearch.resources.requests.memory`        | Requested memory.                                           | `2Gi`            |
| `opensearch.resources.limits.cpu`             | CPU limit.                                                  | `2`              |
| `opensearch.resources.limits.memory`          | Memory limit.                                               | `4Gi`            |

### Redis

| Name                                           | Description                                                 | Value        |
| ---------------------------------------------- | ----------------------------------------------------------- | ------------ |
| `redis.chartManaged`                           | Manage Redis via this chart.                                | `true`       |
| `redis.external.architecture`                  | Redis architecture for external mode.                       | `standalone` |
| `redis.external.connectionString.value`        | Redis connection string URL.                                | `""`         |
| `redis.external.connectionString.secretKeyRef` | Secret ref for connection string.                           | `{}`         |
| `redis.auth.enabled`                           | Enable Redis AUTH.                                          | `true`       |
| `redis.auth.password`                          | Redis password (autogenerated if empty when chart-managed). | `""`         |
| `redis.auth.existingSecret`                    | Existing secret for Redis password.                         | `""`         |
| `redis.auth.secretKeys.passwordKey`            | Password key name.                                          | `password`   |
| `redis.architecture`                           | Redis architecture (standalone|cluster).                    | `standalone` |
| `redis.master.persistence`                     | Persistent volume for master.                               |              |
| `redis.master.persistence.enabled`             | Enable persistence.                                         | `true`       |
| `redis.master.persistence.size`                | PVC size.                                                   | `10Gi`       |
| `redis.master.persistence.storageClass`        | Storage class.                                              | `""`         |
| `redis.master.resources`                       | Resource requests and limits.                               |              |
| `redis.master.resources.requests.cpu`          | Requested CPU.                                              | `250m`       |
| `redis.master.resources.requests.memory`       | Requested memory.                                           | `256Mi`      |
| `redis.master.resources.limits.cpu`            | CPU limit.                                                  | `500m`       |
| `redis.master.resources.limits.memory`         | Memory limit.                                               | `512Mi`      |

_This section will be replaced by the generator._


