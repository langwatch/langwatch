Feature: Contact Sales URL points to public demo form
  As a prospective customer clicking "Contact Sales" anywhere in the app
  I want to be taken to the public demo request form
  So that I reach an owned LangWatch surface rather than a personal HubSpot scheduling link

  Background:
    Given the licensing constants module exposes a `CONTACT_SALES_URL` value
    And every "Contact Sales" CTA in the app imports that constant rather than hardcoding a URL

  @unit
  Scenario: CONTACT_SALES_URL resolves to the public demo form
    Given the licensing constants module is loaded
    When I read `CONTACT_SALES_URL`
    Then it equals "https://langwatch.ai/get-a-demo"

  @unit
  Scenario: No personal HubSpot scheduling URL remains anywhere in the app
    Given the langwatch source tree (`langwatch/src` and `langwatch/ee`)
    When I scan it for the string "meetings-eu1.hubspot.com/manouk-draisma"
    Then there are zero matches

  @integration
  Scenario: PlansComparisonPage integration test still passes after the constant change
    Given the existing test at `langwatch/src/components/plans/__tests__/PlansComparisonPage.integration.test.tsx`
    When the suite is run after `CONTACT_SALES_URL` is updated
    Then every assertion in the file still passes
    And no assertion is added that pins the destination URL value at the component layer

  @unit
  Scenario: Help Center self-hosting link is verified absent from app code
    Given the langwatch source tree and the docs source tree
    When I scan for the reported broken URL "self-hosting/overview#self-hosting-overview"
    Then there are zero matches in TypeScript, TSX, MDX, MD, or JSON files
    And the PR description records this absence as evidence that AC #3 is a no-op in this repo

# --- AC Coverage Map ---
# AC 1: "CONTACT_SALES_URL in langwatch/ee/licensing/constants.ts is changed to https://langwatch.ai/get-a-demo"
#       → @unit Scenario: CONTACT_SALES_URL resolves to the public demo form
# AC 2: "All 'Contact Sales' surfaces reflect the new URL — verified via grep that no other hardcoded HubSpot URL remains"
#       → @unit Scenario: No personal HubSpot scheduling URL remains anywhere in the app
#       (covers both halves: surfaces share the constant by reference, and the grep clause is asserted directly)
# AC 3: "Broken self-hosting link in the Help Center is located and either updated or removed"
#       → @unit Scenario: Help Center self-hosting link is verified absent from app code
#       (Investigation found the URL is not present in this repo and the reported URL returns HTTP 200, not 404;
#        per the plan, AC #3 resolves as a documented no-op with grep evidence rather than a code change)
# AC 4: "Existing integration test in PlansComparisonPage.integration.test.tsx still passes"
#       → @integration Scenario: PlansComparisonPage integration test still passes after the constant change
