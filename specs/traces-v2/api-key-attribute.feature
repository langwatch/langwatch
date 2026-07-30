# The ingestion receiver stamps `langwatch.api_key.id` on every authenticated
# request, carrying the id of the ApiKey row that authenticated it. As a raw
# metadata row that id tells an operator nothing, so the drawer resolves it to
# the key's name and links to that key on the API keys settings page.
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/ApiKeyAttribute.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/AttributeTable.tsx
#   langwatch/src/pages/settings/api-keys/apiKeyAnchor.ts

Feature: Ingest API key attribute in the trace drawer
  As a user inspecting a trace
  I want to see which API key ingested it
  So that I can tell where the traffic came from without decoding an internal id

  Background:
    Given the trace drawer is open on a trace carrying "langwatch.api_key.id"

  @integration
  Scenario: The attribute label drops the trailing id segment
    Then the metadata row is labelled "langwatch.api_key"

  @integration
  Scenario: The value resolves to the key's name and links to it
    Given the viewer can see the API key named "CI Pipeline" in their organization
    Then the value shows "CI Pipeline" with the API key icon
    And it links to that key on the API keys settings page

  @integration
  Scenario: An unresolvable key falls back to the raw id
    Given the API key is revoked, deleted, or outside what the viewer can list
    Then the value shows the raw key id
    And it is not a link
