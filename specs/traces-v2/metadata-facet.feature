# Metadata facet — first-class filtering of metadata.* trace attributes
#
# Implementation:
#   langwatch/src/server/app-layer/traces/facet-registry.ts          (TRACE_METADATA_FACET — dynamic_keys, metadata. prefix)
#   langwatch/src/server/app-layer/traces/facets/metadata-keys.ts    (prefix-scoped discovery, reused)
#   langwatch/src/features/traces-v2/components/FilterSidebar/        (Metadata sidebar section + grouping)
#
# Related specs:
#   specs/traces-v2/facet-perspectives.feature   — facet groups / sidebar perspectives
#
# Motivation: users attach business metadata via the SDK (environment, tenant,
# region, ...). It lands in the trace `Attributes` map keyed `metadata.<name>`
# and is auto-pinned in the drawer, but there was no way to discover or filter
# it from the left sidebar — you had to already know the key and hand-type a
# query. The Metadata facet surfaces those keys as a first-class, browsable
# facet. It is syntactic sugar over the existing trace-attribute filter.
#
# Decisions:
#   - The facet discovers ONLY trace attributes whose key starts with
#     `metadata.`, scoped server-side so rare metadata keys are not crowded out
#     of the shared trace-attribute discovery cap.
#   - Keys render with the `metadata.` prefix stripped ("environment", not
#     "metadata.environment") — the prefix is redundant inside the section.
#   - Selecting a value scopes the table to that attribute: it resolves to the
#     existing trace-attribute filter (`Attributes['metadata.<name>'] = value`).
#   - It lives in the Traces group, alongside the other trace-level facets.

Feature: Metadata facet

  Background:
    Given the user is authenticated with "traces:view" permission
    And the filter sidebar is shown

  Rule: The Metadata facet surfaces metadata.* trace attributes

    Scenario: Metadata keys are discovered without their prefix
      Given traces carry the attributes "metadata.environment" and "metadata.tenant"
      When the Metadata facet loads its keys
      Then it lists "environment" and "tenant"
      And it does not list non-metadata attributes such as "langwatch.origin" or "service.name"

    Scenario: The Metadata facet lives in the Traces group
      Then the Metadata facet appears under the Traces group in the sidebar

    Scenario: A project with no metadata attributes shows an empty Metadata section
      Given no trace carries a "metadata." attribute
      When the Metadata facet loads its keys
      Then the Metadata section is empty

  Rule: Selecting a metadata value scopes the table to that attribute

    Scenario: Filtering by a metadata value
      Given the Metadata facet lists "environment"
      When the user selects "development" under "environment"
      Then the trace list is scoped to traces whose "metadata.environment" attribute equals "development"

    Scenario: The metadata filter is the trace-attribute filter underneath
      When the user filters by metadata "environment" equal to "development"
      Then the active filter is equivalent to the trace attribute filter for "metadata.environment"
