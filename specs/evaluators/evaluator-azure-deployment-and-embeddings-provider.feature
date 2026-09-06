Feature: Evaluators reach the Azure deployment and the embeddings provider a project actually has
  As someone running evaluators on a project whose only model provider is Azure
  I want the evaluator to reach the deployment I mapped and embed with a provider I configured
  So that the evaluation returns a verdict instead of a provider rejection

  # Two gaps on the boundary between the platform and langevals, both of
  # which stop an Azure-only project from running a model-backed evaluator.
  #
  # 1. An Azure deployment may be named anything ("prod-judge"), and the
  #    provider carries a mapping from model id to deployment name. The
  #    platform resolved that mapping and then sent it under `deployment` —
  #    a name nothing reads. litellm has no `deployment` argument: it takes
  #    the deployment out of the model string, and langevals rewrites that
  #    string from AZURE_DEPLOYMENT_NAME. So the mapping was resolved
  #    correctly and then discarded, and every call went to a deployment
  #    named after the model id, which on such a provider does not exist.
  #
  # 2. An evaluator that embeds carries an embeddings model, and the default
  #    baked into the evaluator definition names OpenAI. A project that never
  #    configured OpenAI was refused over a provider it does not use and
  #    never picked, with an error naming that provider rather than the
  #    setting that carried it.
  #
  # Scope of what these scenarios observe: the seam either side of the handoff
  # between the platform and the evaluator service. On the platform side they
  # watch what the environment is built to say, taking the model-to-deployment
  # mapping itself as given — it is resolved and covered a layer below. On the
  # service side they watch what the call ends up addressed to. Nothing here
  # calls a real provider.
  #
  # Bindings:
  #   platform/app/src/server/app-layer/evaluations/evaluation-execution.factories.ts
  #   platform/app/src/server/app-layer/evaluations/__tests__/evaluation-execution.factories.unit.test.ts
  #   services/langevals/langevals_core/langevals_core/litellm_patch.py
  #   services/langevals/langevals_core/tests/test_azure_deployment_resolution.py

  @unit
  Scenario: A judge on an Azure deployment named something other than the model reaches that deployment
    Given a project whose Azure provider maps a model to a deployment of another name
    And an evaluator whose judge is that model
    When the platform prepares the evaluator's environment
    Then the deployment name travels under the name langevals reads

  # The same name, sent the way it used to be, still has to work: an
  # evaluator env built by a platform that has not been deployed yet reaches
  # a langevals that has.
  @unit
  Scenario: A deployment named as a call argument still selects the deployment
    Given a call that names its Azure deployment as an argument
    When langevals prepares the call
    Then the request names the deployment rather than the model id

  @unit
  Scenario: The deployment name is never sent as a call argument
    Given a call that names its Azure deployment as an argument
    When langevals prepares the call
    Then no deployment argument survives into the request

  # The embeddings branch merged the caller's own model on top of the
  # rewrite, putting the model id back where the deployment name belonged.
  @unit
  Scenario: An embedding call reaches the mapped deployment rather than the model id
    Given an embedding call on an Azure model whose deployment has another name
    And the caller's own model arrives as a request setting
    When langevals prepares the call
    Then the request names the deployment rather than the model id

  @unit
  Scenario: A deployment name left in the environment does not divert a call to another provider
    Given an Azure embeddings deployment named in the environment
    And an embedding call on a provider that is not Azure
    When langevals prepares the call
    Then the request still names the provider the caller chose

  @unit
  Scenario: An evaluator embeds with the provider the project actually configured
    Given a project that configured no OpenAI provider
    And an evaluator carrying the baked-in OpenAI embeddings default
    When the platform prepares the evaluator's environment
    Then the evaluation embeds with the model the project resolves to

  @unit
  Scenario: A judge model is never swapped for the project's default
    Given a project that configured no OpenAI provider
    And an evaluator whose judge is an OpenAI model
    When the platform prepares the evaluator's environment
    Then the evaluation is refused rather than judged by another model

  @unit
  Scenario: With nothing to fall back to, the refusal names the embeddings setting
    Given a project that configured no OpenAI provider and resolves no embeddings default
    And an evaluator carrying the baked-in OpenAI embeddings default
    When the platform prepares the evaluator's environment
    Then the refusal names the evaluator's embeddings model
