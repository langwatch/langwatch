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

# --- AC Coverage Map ---
# AC 1: "CONTACT_SALES_URL in langwatch/ee/licensing/constants.ts is changed to https://langwatch.ai/get-a-demo"
#       → @unit Scenario: CONTACT_SALES_URL resolves to the public demo form
# AC 2: "All 'Contact Sales' surfaces reflect the new URL — verified via grep that no other hardcoded HubSpot URL remains"
#       → Verified by direct grep in PR body (one source of truth: every consumer imports CONTACT_SALES_URL by reference,
#         so the unit test in scenario 1 transitively covers every CTA). Not a separate scenario — grep is repo-hygiene,
#         not behavior.
# AC 3: "Broken self-hosting link in the Help Center is located and either updated or removed"
#       → Investigation found the URL is not present in this repo (`git log -S` zero hits across full history) and the
#         reported URL returns HTTP 200, not 404. Resolved as a documented no-op in the PR body with curl + grep
#         transcripts. Not a Gherkin scenario — there is no behavior to test.
# AC 4: "Existing integration test in PlansComparisonPage.integration.test.tsx still passes"
#       → Existing test already guards this; no new scenario needed (would be redundant scaffolding).
