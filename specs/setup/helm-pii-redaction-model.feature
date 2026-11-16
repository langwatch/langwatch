Feature: The chart can run the PII redaction model for strict PII analysis
  As someone running LangWatch on my own cluster,
  I want the chart to deploy the PII redaction model and point the app and workers at it,
  so that organizations on Strict get the model instead of Presidio, as on LangWatch Cloud.

  # Cross-references:
  #   charts/langwatch/templates/pii_redaction_model/ - Deployment, Service, PDB.
  #   charts/langwatch/templates/_helpers.tpl - langwatch.piiRedactionModel.endpoint, processEnv.
  #   charts/langwatch/tests/pii-redaction-model.sh - renders the chart and asserts these.
  #   modules/data-privacy/README.md - "PII redaction model": routing, time cap, fallbacks.

  # The model is one public multi-arch image (the mixed build), whose source is not public
  # and whose binary checks the licence. It stays off in every profile until that image is
  # published (item I08), which waits on the licence check in the binary (item I07);
  # size-prod and size-ha carry its sizing (7Gi memory request and limit) for that day. It answers the Presidio route on port 8080 and /healthz once its
  # models have loaded. Any failure of the model falls back to Presidio, so turning it off,
  # or a pod that is not ready, never stops strict redaction.

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
      And size-prod runs one replica and size-ha runs two with a PodDisruptionBudget

  Rule: Turned on, the app and the workers reach the model and nothing else does

    @e2e
    Scenario: The app and the workers get the chart's Service as PII_REDACTION_MODEL_ENDPOINT
      Given piiRedactionModel.enabled is true
      When the chart renders
      Then the app and workers containers have PII_REDACTION_MODEL_ENDPOINT set to the model's Service
      And no other workload has it

    @e2e
    Scenario: Deploying the model releases it for every organization, at zero price
      Given piiRedactionModel.enabled is true
      When the chart renders
      Then FEATURE_FLAG_FORCE_ENABLE on the app and workers includes release_pii_redaction_model_enabled and release_pii_redaction_model_free
      And with enableForAllOrganizations and recordAtZeroPrice false it includes neither

    @e2e
    Scenario: A model outside the release is reached through externalEndpoint
      Given piiRedactionModel.enabled is false and piiRedactionModel.externalEndpoint is set
      When the chart renders
      Then the app and workers have PII_REDACTION_MODEL_ENDPOINT set to that address
      And the chart deploys no model

  Rule: The model pod runs the image the operator names, the way Cloud runs it

    @e2e
    Scenario: The image, pull secrets and probes come from values and the image's contract
      Given piiRedactionModel.enabled is true
      When the chart renders
      Then the container runs the public langwatch/pii-redaction-model image at the chart's release with no pull secret
      And a repository, a tag and an optional imagePullSecret from values replace it
      And its startup, readiness and liveness probes are on /healthz
      And it has 100 s to drain and THREADS follows its CPU limit

    @e2e
    Scenario: Without an image the chart refuses to render
      Given piiRedactionModel.enabled is true and no image repository
      When the chart renders
      Then helm refuses, naming images.pii_redaction_model
