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

  # The name is resolved one id at a time through `apiKey.nameById`, which any
  # member of the organization may call. Reading it off the admin-gated key
  # list instead would have shown most of the team a raw row id, which is the
  # unreadable value this feature exists to replace.
  @integration
  Scenario: The value resolves to the key's name and links to it
    Given the API key named "CI Pipeline" belongs to the viewer's organization
    And the viewer is an ordinary member with no key administration rights
    Then the value shows "CI Pipeline" with the API key icon
    And it links to that key on the API keys settings page

  # A revoked key's traces are still readable, so naming the key that produced
  # them is still the useful answer.
  @integration
  Scenario: A revoked key still shows its name
    Given the API key that ingested the trace has since been revoked
    Then the value shows the key's name rather than the raw id

  @integration
  Scenario: An unresolvable key falls back to the raw id
    Given the API key is deleted, from another organization, or the view is publicly shared
    Then the value shows the raw key id
    And it is not a link
