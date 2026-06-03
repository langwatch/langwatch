Feature: SSO Settings UI Prototype
  As an organization admin on an enterprise plan
  I want to configure SSO connections, view SCIM settings, and manage enforcement
  So that my team can authenticate via our identity provider without engineering help

  # SSO/SCIM settings UI (connection table, provider modal, attribute/role
  # mapping, SCIM logs) for per-org SSO. The per-org SSO runtime is backed by
  # the @better-auth/sso plugin: OIDC (with id_token signature validation) and
  # SAML (via samlify) are both real, working login flows — not hand-rolled.
  # The settings UI persists provider config into the plugin's SsoProvider
  # record (oidcConfig / samlConfig) plus a LangWatch policy companion for
  # enforcement, JIT, and role mapping.

  Background:
    Given the user is an organization admin
    And the organization settings page is open

  # ── Access Control ──

  @integration
  Scenario: Non-admin is blocked by permission guard
    Given the user does not have "organization:manage" permission
    When the user navigates to /settings/sso
    Then the page renders a permission denied message

  @integration
  Scenario: Non-enterprise org sees locked SSO settings
    Given the organization does not have an enterprise license
    When the admin navigates to the SSO settings section
    Then the page renders an upgrade prompt instead of SSO controls
    And the nav item for "SSO" is visible but gated

  @integration
  Scenario: Enterprise org sees full SSO settings
    Given the organization has an enterprise license
    When the admin navigates to the SSO settings section
    Then the SSO connections table is rendered
    And the SCIM provisioning section is rendered

  # ── SSO Connections Table ──

  @integration
  Scenario: Empty state shows add connection prompt
    Given no SSO connections exist
    When the admin views the SSO connections table
    Then a message prompts to add the first SSO connection
    And an "Add SSO Connection" button is visible

  @integration
  Scenario: Existing connection renders in table
    Given an SSO connection exists for domain "acme.com" with provider "okta"
    When the admin views the SSO connections table
    Then a row shows domain "acme.com", provider "Okta", status badge, and enforce toggle

  @integration
  Scenario: Enforce toggle can be toggled inline
    Given an SSO connection exists for domain "acme.com"
    When the admin toggles the enforce switch in the table row
    Then the connection's ssoEnforced state is updated

  @integration
  Scenario: Actions menu offers edit and delete
    Given an SSO connection exists for domain "acme.com"
    When the admin clicks the actions menu for "acme.com"
    Then options for "Edit" and "Delete" are shown

  @integration
  Scenario: Edit opens modal pre-filled with existing connection
    Given an SSO connection exists for domain "acme.com"
    When the admin clicks "Edit" from the actions menu
    Then the SSO connection modal opens with the domain field disabled
    And the existing provider, enforcement, and mapping settings are pre-filled

  @integration
  Scenario: Delete shows confirmation dialog
    Given an SSO connection exists for domain "acme.com"
    When the admin clicks "Delete" from the actions menu
    Then a confirmation dialog warns that users on "acme.com" will lose SSO
    And the dialog has Cancel and Delete buttons

  @integration
  Scenario: Multiple connections show add row at bottom
    Given SSO connections exist for "acme.com" and "corp.io"
    When the admin views the SSO connections table
    Then a clickable row at the bottom says "Add SSO Connection"

  # ── Add/Edit SSO Connection Modal ──

  @integration
  Scenario: Add connection modal renders all sections
    When the admin clicks "Add SSO Connection"
    Then a modal opens with sections for domain, verification, provider, enforcement, and advanced settings
    And the advanced sections for attribute mapping and role mapping are collapsed

  @integration
  Scenario: Domain verification section shows DNS instructions
    When the admin enters domain "acme.com" in the modal
    Then the verification section shows a TXT record host "_langwatch-verification" with a copy button
    And the verification section shows a token value "langwatch-verify=..." with a copy button
    And a "Verify Domain" button is shown

  @integration
  Scenario: Domain verification status badge reflects state
    When the admin enters a domain in the modal
    Then a "Pending" badge is shown when the domain is not yet verified
    And a "Verified" badge is shown when the domain has been verified

  @integration
  Scenario: OIDC redirect URI is shown with copy button
    Given the admin is configuring an OIDC provider with provider ID "acme-okta"
    When the admin enters domain "acme.com" in the modal
    Then a read-only redirect URI "{origin}/api/auth/sso/callback/acme-okta" is displayed
    And a copy button is shown next to the redirect URI

  @integration
  Scenario: SAML ACS and SP metadata URLs are shown for SAML providers
    Given the admin is configuring a SAML provider with provider ID "acme-saml"
    When the admin selects "Custom SAML" as the provider
    Then a read-only ACS URL "{origin}/api/auth/sso/saml2/callback/acme-saml" is displayed
    And a read-only SP metadata URL "{origin}/api/auth/sso/saml2/sp/metadata?providerId=acme-saml" is displayed

  @integration
  Scenario: Provider dropdown shows supported providers
    When the admin clicks the provider dropdown
    Then the options include "Okta", "Azure AD / Entra ID", "Google Workspace", "Custom OIDC", and "Custom SAML"

  # ── Provider-Specific Fields ──

  @integration
  Scenario: Provider-specific fields render for Okta
    When the admin selects "Okta" as the provider
    Then fields for Client ID, Client Secret, and Issuer URL are shown

  @integration
  Scenario: Provider-specific fields render for Azure AD
    When the admin selects "Azure AD" as the provider
    Then fields for Client ID, Client Secret, and Tenant ID are shown

  @integration
  Scenario: Provider-specific fields render for Google Workspace
    When the admin selects "Google Workspace" as the provider
    Then fields for Client ID and Client Secret are shown
    And no Issuer URL or Tenant ID field is shown

  @integration
  Scenario: Provider-specific fields render for Custom OIDC
    When the admin selects "Custom OIDC" as the provider
    Then fields for Client ID, Client Secret, and Issuer URL are shown

  @integration
  Scenario: Provider-specific fields render for Custom SAML
    When the admin selects "Custom SAML" as the provider
    Then fields for SAML Entity ID, SSO URL, and X.509 Certificate are shown
    And the certificate field is a multi-line textarea

  # ── Enforcement & Provisioning ──

  @integration
  Scenario: Enforcement toggles render
    Then a toggle for "Enforce SSO" is shown with description about blocking password login
    And a toggle for "Enable JIT provisioning" is shown
    And a "Default role" dropdown with ADMIN, MEMBER, VIEWER options is shown

  # ── Advanced: Attribute Mapping ──

  @integration
  Scenario: Attribute mapping section expands with 4 claim fields
    When the admin expands the "Attribute Mapping" advanced section
    Then fields for Email claim, Name claim, Groups claim, and Role claim are shown
    And each field has a default value pre-filled

  # ── Advanced: Role Mapping ──

  @integration
  Scenario: Role mapping section expands with group-to-role list
    When the admin expands the "Role Mapping" advanced section
    Then a default role dropdown is shown
    And a "Use role attribute directly" toggle is shown
    And a dynamic list for group-to-role mappings is shown with add/remove controls

  @integration
  Scenario: Use role attribute hides group mappings
    When the admin enables "Use role attribute directly"
    Then the group-to-role mapping list is hidden

  @integration
  Scenario: Group mapping supports add and remove
    When the admin clicks "Add Group Mapping"
    Then a new row appears with an IdP group name input and a role dropdown
    And a remove button is shown for each mapping row

  # ── Save Flow ──

  @integration
  Scenario: Save requires domain and client ID
    When the admin clicks Save without filling domain or client ID
    Then an error message prompts to fill required fields

  @integration
  Scenario: Save shows confirmation dialog
    When the admin fills required fields and clicks Save
    Then a confirmation dialog warns that users at the domain will be redirected to the IdP
    And the dialog has Cancel and "Activate SSO" buttons

  # ── SCIM Section ──

  @integration
  Scenario: SCIM section links to token management
    When the admin views the SCIM provisioning section
    Then a link to the SCIM token management page is shown

  @integration
  Scenario: SCIM logs table renders with filter controls
    When the admin views the SCIM logs area
    Then a table with columns for Time, Method, Path, Status, and Duration is shown
    And filter buttons for All, 2xx, 4xx, and 5xx are rendered
    And a search input for filtering by path is shown

  @integration
  Scenario: SCIM logs empty state when no logs match filters
    When the admin applies filters that match no SCIM requests
    Then a message says "No SCIM requests match the current filters."

  # ── Documentation Deliverables (non-UI) ──

  Scenario: Validation findings documented
    Then a findings doc exists covering:
      | Finding                                         | Priority |
      | Password login not blocked by SSO enforcement   | P0       |
      | Password reset not blocked by SSO enforcement   | P0       |
      | SCIM deleteUser race condition                  | P0       |
      | SCIM 409 on existing membership                 | P0       |
      | SCIM v2 routes missing enterprise plan check    | P0       |
      | SCIM settings page missing enterprise gate      | P1       |
      | Email change not blocked for SSO-enforced domains | P1     |
      | No SSO re-verification window                   | P2       |
      | No login-time license revalidation              | P2       |
      | Role mapping algorithm (group-priority-based)   | Decision |
      | SCIM-wins model with scimManaged flag           | Decision |
      | Sole-owner escape hatch for SSO enforcement     | Decision |
      | JIT + SCIM precedence rules                     | Decision |
      | Enterprise gating 3-layer model                 | Decision |
      | Domain verification (DNS TXT)                   | Decision |
