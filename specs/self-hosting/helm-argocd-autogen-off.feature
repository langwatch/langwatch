Feature: Helm installs with operator-owned Secrets under Argo CD

  With autogen.enabled=false the operator owns every credential, usually
  through a secret manager, and Argo CD renders the chart with no cluster
  access and as revision 1 on every sync. Such an install converges on the
  first sync and stays in sync: nothing the chart renders changes between
  syncs, every key name can match the secret store, a missing optional key
  never blocks ClickHouse, and no credential reaches the logs.

  # Bindings: charts/langwatch/tests/autogen-off-and-argocd.sh (the
  # "render + assertions" job in .github/workflows/langwatch-chart.yml),
  # packages/redis-client/src/connection.test.ts and
  # packages/observability/src/__tests__/redisCredentialRedaction.unit.test.ts.

  Rule: The render is stable without cluster access

    @unit
    Scenario: an autogen-off install renders the same manifests on every sync
      Given autogen.enabled is false and every Secret is operator-owned
      When the chart renders twice with no cluster access
      Then both renders succeed and are identical
      And the chart renders no Secret of its own

    @unit
    Scenario: chart-managed Redis and PostgreSQL never generate a password with autogen off
      Given autogen.enabled is false
      And chart-managed Redis or PostgreSQL has no existingSecret and no password
      When the chart renders
      Then the render fails naming redis.auth.existingSecret or postgresql.auth.existingSecret
      And an explicit password value still renders
      And with autogen.enabled true the chart still generates both passwords

  Rule: Key names follow the secret store

    @unit
    Scenario: remapped Secret key names reach every consumer
      Given the app Secret uses dashed key names
      And gateway.secrets.internalSecretKey, gateway.secrets.jwtSecretKey and secrets.secretKeys name them
      When the chart renders
      Then the app and the gateway pod read the gateway keys under those names
      And the app reads the LangWatchQL passwords under the names in secrets.secretKeys
      And with autogen the chart writes the gateway keys under the configured names

  Rule: LangWatchQL never blocks ClickHouse

    @unit
    Scenario: the LangWatchQL render Job is named by its spec
      Given the chart renders twice with the same values
      Then the render Job has the same name both times
      And a new app image gives it a new name
      And the install Job does not expire, while the upgrade hook does

    @unit
    Scenario: missing LangWatchQL passwords never leave ClickHouse waiting
      Given the Secret has no LangWatchQL password keys
      When the render Job runs
      Then it succeeds and writes an empty access model
      And its log names the Secret and the missing keys
      And with both keys present it renders the access model

  Rule: StatefulSets stay in sync under server-side diff

    @unit
    Scenario: StatefulSet claim templates match what the API server stores
      Given chart-managed PostgreSQL, Redis and replicated ClickHouse
      When the chart renders
      Then every volumeClaimTemplates entry names apiVersion v1 and kind PersistentVolumeClaim

  Rule: Credentials never reach the logs

    @unit
    Scenario: the Redis password never reaches the logs
      Given Redis rejects the password with WRONGPASS
      When the connection error is logged, or reaches the unhandled-rejection handler
      Then the logged command arguments are redacted
      And the error message is kept

  @unit
  Scenario: the Secrets the render Job reads sync before it under Argo CD
    Given the chart renders its own app, ClickHouse, PostgreSQL and Redis Secrets
    When Argo CD orders the sync by wave
    Then each of those Secrets syncs in a wave before the LangWatchQL render Job
