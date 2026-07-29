Feature: Azure OpenAI provider routing through in-app dispatch paths
  Customers who configure an Azure OpenAI provider in LangWatch (resource
  endpoint + API key + a deployed model) must be able to use it from every
  in-app feature — the Scenario User Simulator, the playground, and
  prompt-testing — not only from virtual-key gateway traffic. Those in-app
  features dispatch through the nlp-service /go/proxy path, which carries the
  Azure endpoint under the litellm-era name "api_base". The gateway must
  resolve that endpoint and the model's deployment so the call reaches Azure,
  instead of failing before any request leaves the box.

  Regression context (issue #5760): Azure calls through /go/proxy failed on
  every attempt with a 502 dispatcher_error whose inner reason was
  "endpoint not set", because the endpoint arrived under "api_base" but the
  gateway's Azure key-builder read only "endpoint".

  Background:
    Given a project with an Azure OpenAI provider configured
    And its resource endpoint and API key are correct
    And the requested model is a deployed Azure deployment

  Scenario: Scenario User Simulator against an Azure model completes
    When a scenario run whose User Simulator uses the Azure model is executed
    Then the User Simulator's completion reaches the Azure endpoint
    And the run does not fail with "endpoint not set"

  Scenario: Playground chat completion against Azure reaches the resource endpoint
    When the playground dispatches a chat completion using the Azure provider
    Then the upstream request is sent to the configured Azure resource endpoint
    And the gateway does not return a dispatcher_error

  Scenario: The Azure deployment is resolved for the requested model
    When a chat completion for the Azure model is dispatched through /go/proxy
    Then the request targets the model's Azure deployment
    And the dispatch does not fail with "deployments not set"

  Scenario: An explicit deployment name different from the model id is honored
    Given the provider maps the model to a deployment name that differs from the model id
    When a chat completion for that model is dispatched through /go/proxy
    Then the request targets the mapped deployment name

  Scenario: Custom OpenAI-compatible providers still reach their endpoint
    Given a custom OpenAI-compatible provider whose endpoint arrives under "api_base"
    When a chat completion is dispatched through /go/proxy
    Then the upstream request is still sent to the customer's endpoint

  Scenario: Virtual-key gateway Azure traffic still resolves the endpoint
    Given an Azure provider slot on a virtual key whose endpoint arrives under "endpoint"
    When a chat completion is sent through the gateway
    Then the upstream request is sent to the configured Azure resource endpoint
