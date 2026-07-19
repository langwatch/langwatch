/**
 * Test-only ENTERPRISE license for the member-invitation e2e tests.
 *
 * A no-license self-hosted deployment resolves to FREE_PLAN (maxMembers=1), so
 * the org owner alone is at the cap and inviting anyone 403s. Activating this
 * license (see members/steps.ts `withEnterpriseLicense()`, which activates it
 * before each members test and removes it after) raises the org to ENTERPRISE
 * (maxMembers=100) so the invitation flows can be exercised.
 *
 * This is the pre-signed `ENTERPRISE_LICENSE_KEY` fixture from
 * `platform/app/ee/licensing/__tests__/fixtures/testLicenses.ts`, signed with the
 * in-repo TEST keypair (`.../fixtures/testKeys.ts` `TEST_PRIVATE_KEY`), plan
 * ENTERPRISE, maxMembers=100, expires 2030-12-31. It is copied here as a literal
 * because agentic-e2e-tests is a standalone pnpm project (installed with
 * `--ignore-workspace`) and cannot import across the workspace boundary.
 *
 * The app trusts it only because the e2e-ci workflow sets
 * `LANGWATCH_LICENSE_PUBLIC_KEY` to the matching `TEST_PUBLIC_KEY`. If the
 * in-repo test keypair is ever rotated, update BOTH this string and the
 * workflow's public key — a mismatch makes the license fail validation, the org
 * falls back to FREE_PLAN, and these specs fail loudly (invite 403s).
 *
 * gitleaks:allow — test-only signed license, not a real secret
 */
export const E2E_ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAzMC0xMi0zMVQyMzo1OTo1OVoiLCJwbGFuIjp7InR5cGUiOiJFTlRFUlBSSVNFIiwibmFtZSI6IkVudGVycHJpc2UiLCJtYXhNZW1iZXJzIjoxMDAsIm1heFByb2plY3RzIjo1MDAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjEwMDAwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwMDAsIm1heFdvcmtmbG93cyI6MTAwMCwibWF4UHJvbXB0cyI6MTAwMCwibWF4RXZhbHVhdG9ycyI6MTAwMCwibWF4U2NlbmFyaW9zIjoxMDAwLCJtYXhBZ2VudHMiOjEwMDAsIm1heEV4cGVyaW1lbnRzIjoxMDAwLCJtYXhPbmxpbmVFdmFsdWF0aW9ucyI6MTAwMCwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJhRDlLVkx0V2JOT3pGc3JrOUxHQzdhWEZRdk41MDVBR1VHSWVpcXN5S0tYM1IzK3o1aXIrV01lTS9tQVovOVBOeGRDalUrODVLS3A4TFAweDhIcWl0YnRubVprNVhqQ29uNWQ3S1Q3WFhwOWtsd2tEV0VocnNuL2F5ZWlYcWw0eElzUWZMNG92QitaZEt3TFVQUVFucWFGUVhFU093WEt2akp4QzU0VFp6bUk4THBXbSthYk10Qm50VFNxaFVaamRMdkJJWTlVbHR6LzU2T3pvUmgvdlJuSXhleUdlVkJCK3pWaVQ3LzF6YkpGMG5QZ1ZhVW9GUHI1dFRGYzRvS1VPdXRJSjRyWVJPSkFQNUlUbjZ4OHJLSDBXNi9QSmNVeWlHUE9TL085UXhCVXhGWml0Y3R6UDlwZURGeGhxcm5wbGxUdE1iVER6SVprS3gyMWFadDJMRUE9PSJ9";
