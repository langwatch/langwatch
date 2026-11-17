Feature: The chart can run the PII redaction model for strict PII analysis
  As someone running LangWatch on my own cluster,
  I want the chart to deploy the PII redaction model and point the app and workers at it,
  so that organizations on Strict get the model instead of Presidio, as on LangWatch Cloud.

  # Cross-references:
  #   charts/langwatch/templates/pii_redaction_model/ - Deployment, Service, PDB.
  #   charts/langwatch/templates/_helpers.tpl - langwatch.piiRedactionModel.endpoint, processEnv.
  #   charts/langwatch/tests/pii-redaction-model.sh - renders the chart and asserts these.
  #   modules/data-privacy/README.md - "PII redaction model": routing, time cap, fallbacks.

  # The model is one public multi-arch image, off by default in every profile. It answers
  # the Presidio route on port 8080 and /healthz once its models have loaded. Any failure
  # of the model falls back to Presidio, so a pod that is not ready never stops redaction.

  Rule: The model is off unless the operator turns it on

    @e2e
    Scenario: The default install deploys no model and sets no endpoint
      Given the default values
      When the chart renders
      Then there is no PII redaction model Deployment or Service
      And neither the app nor the workers have PII_REDACTION_MODEL_ENDPOINT

    @e2e
    Scenario: Every size profile leaves the model off
      Given the size-dev, size-minimal, size-prod or size-ha profile
      When the chart renders
      Then there is no PII redaction model Deployment

    @e2e
    Scenario: Turned on, the prod and HA profiles run the model with its measured sizing
      Given the size-prod or the size-ha profile with piiRedactionModel.enabled true
      When the chart renders
      Then the PII redaction model Deployment requests and limits 7Gi of memory
      And size-prod and size-ha run two replicas with a PodDisruptionBudget
      And the size-ha zone spread counts only this release's pods

  Rule: Turned on, the app and the workers reach the model and nothing else does

    @e2e
    Scenario: The app and the workers get the chart's Service as PII_REDACTION_MODEL_ENDPOINT
      Given piiRedactionModel.enabled is true
      When the chart renders
      Then the app and workers containers have PII_REDACTION_MODEL_ENDPOINT set to the model's Service
      And no other workload has it

    @e2e
    Scenario: Deploying the model releases it for every organization
      Given piiRedactionModel.enabled is true
      When the chart renders
      Then FEATURE_FLAG_FORCE_ENABLE on the app and workers includes release_pii_redaction_model_enabled
      And it does not force release_pii_redaction_model_free: the server never prices a self-hosted call

    @e2e
    Scenario: A model outside the release is reached through externalEndpoint
      Given piiRedactionModel.enabled is false and piiRedactionModel.externalEndpoint is set
      When the chart renders
      Then the app and workers have PII_REDACTION_MODEL_ENDPOINT set to that address
      And the chart deploys no model

    @e2e
    Scenario: An external model also releases it for every organization
      Given piiRedactionModel.enabled is false and piiRedactionModel.externalEndpoint is set
      When the chart renders
      Then FEATURE_FLAG_FORCE_ENABLE on the app and workers includes release_pii_redaction_model_enabled

  Rule: The model pod runs the image the operator names, the way Cloud runs it

    @e2e
    Scenario: The image, pull secrets and probes come from values and the image's contract
      Given piiRedactionModel.enabled is true
      When the chart renders
      Then the container runs the public langwatch/pii-redaction-model image at the chart's release with no pull secret
      And a repository, a tag and an optional imagePullSecret from values replace it
      And its startup, readiness and liveness probes are on /healthz, the startup probe allowing 180 s
      And its request deadline is 45 s, under the app's 50 s abort, and it has 80 s to drain
      And an extraEnvs entry replaces the chart's own setting of the same name, once
      And an extraEnvs entry for PORT is refused, since the port, the Service and the probes are fixed

    @e2e
    Scenario: Without an image the chart refuses to render
      Given piiRedactionModel.enabled is true and no image repository
      When the chart renders
      Then helm refuses, naming images.pii_redaction_model
