# Trace explorer: an empty search for an email address says why
#
# Implementation:
#   platform/app/src/features/traces-v2/components/TraceTable/EmptyFilterState.tsx
#   platform/app/src/features/traces-v2/utils/emailShapedQuery.ts
#   platform/app/src/components/ui/PIIRedactionNotice.tsx  (the shared alert and its settings link)
#
# Motivation: a project's privacy settings replace email addresses with the
# [EMAIL_ADDRESS] marker before a trace is stored, and they do so by default.
# A search for a customer's address then finds nothing, which reads as the
# customer never having written in. The empty state names the cause when the
# query carries an address and the project redacts PII, and points at the
# setting and at what to search by instead.

Feature: Email search redaction notice

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace explorer shows no traces for the current query

  Rule: An empty search for an email address names redaction as the cause

    @integration
    Scenario: An email-shaped query with no results shows the redaction notice
      Given the query is "priya.raman@northwind.example"
      And the project's effective PII level redacts email addresses
      Then a notice says email addresses are redacted before a trace is stored
      And it names a thread id, a trace id or a name as what to search by
      And it links to the data-privacy settings page

    @integration
    Scenario: The notice is not shown when PII redaction is disabled
      Given the query is "priya.raman@northwind.example"
      And the project's effective PII level is disabled
      Then no redaction notice is shown

    @integration
    Scenario: A custom PII level that leaves email addresses out shows no notice
      Given the query is "priya.raman@northwind.example"
      And the project's effective PII level is custom without email addresses
      Then no redaction notice is shown

    @integration
    Scenario: A custom PII level that names email addresses shows the notice
      Given the query is "priya.raman@northwind.example"
      And the project's effective PII level is custom with email addresses
      Then a notice says email addresses are redacted before a trace is stored

    @integration
    Scenario: A non-email query with no results shows no notice
      Given the query is "refund never arrived"
      Then no redaction notice is shown
      And the privacy settings are not read
