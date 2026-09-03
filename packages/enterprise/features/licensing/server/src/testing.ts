// gitleaks:allow — test fixture keys only (not real secrets)
/**
 * Test license fixtures - pre-generated static constants.
 * License generation logic stays in lw-saas only.
 */
import type { LicenseData } from "@langwatch/enterprise-licensing-contract";

/**
 * Base license data template - PRO plan.
 * Used for reference in tests to know expected values.
 */
export const BASE_LICENSE: LicenseData = {
  licenseId: "lic-001",
  version: 1,
  organizationName: "Acme Corp",
  email: "admin@acme.corp",
  issuedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2030-12-31T23:59:59Z",
  plan: {
    type: "PRO",
    name: "Pro",
    maxMembers: 5,
    maxProjects: 10,
    maxMessagesPerMonth: 50000,
    evaluationsCredit: 100,
    maxWorkflows: 25,
    maxPrompts: 25,
    maxEvaluators: 25,
    maxScenarios: 25,
    canPublish: true,
  },
};

/**
 * Enterprise license data - for reference in tests.
 */
export const ENTERPRISE_LICENSE: LicenseData = {
  licenseId: "lic-001",
  version: 1,
  organizationName: "Acme Corp",
  email: "admin@acme.corp",
  issuedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2030-12-31T23:59:59Z",
  plan: {
    type: "ENTERPRISE",
    name: "Enterprise",
    maxMembers: 100,
    maxProjects: 500,
    maxMessagesPerMonth: 10000000,
    evaluationsCredit: 10000,
    maxWorkflows: 1000,
    maxPrompts: 1000,
    maxEvaluators: 1000,
    maxScenarios: 1000,
    maxAgents: 1000,
    maxExperiments: 1000,
    maxOnlineEvaluations: 1000,
    canPublish: true,
  },
};

// =============================================================================
// Pre-signed static license keys (generated using TEST_PRIVATE_KEY)
// =============================================================================

/** Valid PRO license - signed with TEST_PRIVATE_KEY, expires 2030 */
export const VALID_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAzMC0xMi0zMVQyMzo1OTo1OVoiLCJwbGFuIjp7InR5cGUiOiJQUk8iLCJuYW1lIjoiUHJvIiwibWF4TWVtYmVycyI6NSwibWF4UHJvamVjdHMiOjEwLCJtYXhNZXNzYWdlc1Blck1vbnRoIjo1MDAwMCwiZXZhbHVhdGlvbnNDcmVkaXQiOjEwMCwibWF4V29ya2Zsb3dzIjoyNSwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJSU3YyWTIyOHNkSWdONXk2eUpZbUxOb2FFUGNiMlZyY3pPWDU1VlQwN0ljSG1ZQVltSGI5WTloV09RYkdmdENsRTdqUXZLMG9YV2pra1FGc1l2U011UFViN1d5MzJINGF1RG9DZ0FhVEw0dnE4YWgwMFhvbjZHblBOM1Y2SXZDU2R4T0FRR2ptUEc2NDFOelNEcVpCYkQvVENoeHhIMzhYNWtWYmZJRVMvYzZNa2lVVUwraVVWWURvazVPbDRyOXhKazljTFZQOHBGU2JOV2t1dTVvMFRUTUdXczJtWmRrWkZSUGprNlVrUDEvTEF0aUtDQnRTcHJ1T2RqNXRQV3d4cElMaUJ4RW5CYnFtUlFxYlhRMkJEVkVEMkgyKzFDRUVwekIvSllIdFNyR0VncSs0YVNUcUw4YVJsQTBPZFNoakk3WWVyWXEwSlVWcXNKa2hCRHd6cmc9PSJ9";

/** Expired license - signed with TEST_PRIVATE_KEY, expired 2020-01-01 */
export const EXPIRED_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAyMC0wMS0wMVQwMDowMDowMFoiLCJwbGFuIjp7InR5cGUiOiJQUk8iLCJuYW1lIjoiUHJvIiwibWF4TWVtYmVycyI6NSwibWF4UHJvamVjdHMiOjEwLCJtYXhNZXNzYWdlc1Blck1vbnRoIjo1MDAwMCwiZXZhbHVhdGlvbnNDcmVkaXQiOjEwMCwibWF4V29ya2Zsb3dzIjoyNSwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJlNkxkUWt0WW5qQ3BnUkZLMGFvbU81bENUQ2EzRUVjVlpHVHpiR2N4bUVvUkVmcFIwb1BEZHE2OEFpRDVzWUk0N1V6L0NldHRwUTY5NnMvZUlzNXlyRFZ2OGUxbmdFelY4eTNyUDlpVmhsb1RwTE82TUNVZ29ZVkh4ZzNyMHNsU0NsWWxGSHdsTXpHNTR4UGFBWFpVa1hDR3BDWVZ6dnlET1pnZ3V5USsrU283WFJ4dUhYMDgvaDRxWjYrdmFPUXlPMTN6K09RYkFSQmpPRTFYQ2M0YjczLzZjakxHZURKUGs0dk85eGNaSVFCY2dTUEYyUnM0dW82dW8rVTEzbG9uRExUUVpsbkZzYVFZamZnUXQvTFR2dVpxdUNiNVNYSTRIdXlWSXFVaFg5VGZ3TU8vSmZsV2U2SGJRN1RCRVdXMXVXTUt3eS9BM3lxejlmTUpQOEZRQ2c9PSJ9";

/** Tampered license - data modified after signing, signature doesn't match */
export const TAMPERED_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiSGFja2VyIENvcnAiLCJlbWFpbCI6ImFkbWluQGFjbWUuY29ycCIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMFoiLCJleHBpcmVzQXQiOiIyMDMwLTEyLTMxVDIzOjU5OjU5WiIsInBsYW4iOnsidHlwZSI6IlBSTyIsIm5hbWUiOiJQcm8iLCJtYXhNZW1iZXJzIjo1LCJtYXhQcm9qZWN0cyI6MTAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjUwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwLCJtYXhXb3JrZmxvd3MiOjI1LCJjYW5QdWJsaXNoIjp0cnVlfX0sInNpZ25hdHVyZSI6IlJTdjJZMjI4c2RJZ041eTZ5SlltTE5vYUVQY2IyVnJjek9YNTVWVDA3SWNIbVlBWW1IYjlZOWhXT1FiR2Z0Q2xFN2pRdkswb1hXamtrUUZzWXZTTXVQVWI3V3kzMkg0YXVEb0NnQWFUTDR2cThhaDAwWG9uNkduUE4zVjZJdkNTZHhPQVFHam1QRzY0MU56U0RxWkJiRC9UQ2h4eEgzOFg1a1ZiZklFUy9jNk1raVVVTCtpVVZZRG9rNU9sNHI5eEprOWNMVlA4cEZTYk5Xa3V1NW8wVFRNR1dzMm1aZGtaRlJQams2VWtQMS9MQXRpS0NCdFNwcnVPZGo1dFBXd3hwSUxpQnhFbkJicW1SUXFiWFEyQkRWRUQySDIrMUNFRXB6Qi9KWUh0U3JHRWdxKzRhU1RxTDhhUmxBME9kU2hqSTdZZXJZcTBKVVZxc0praEJEd3pyZz09In0=";

/** License with empty signature field */
export const EMPTY_SIGNATURE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAzMC0xMi0zMVQyMzo1OTo1OVoiLCJwbGFuIjp7InR5cGUiOiJQUk8iLCJuYW1lIjoiUHJvIiwibWF4TWVtYmVycyI6NSwibWF4UHJvamVjdHMiOjEwLCJtYXhNZXNzYWdlc1Blck1vbnRoIjo1MDAwMCwiZXZhbHVhdGlvbnNDcmVkaXQiOjEwMCwibWF4V29ya2Zsb3dzIjoyNSwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiIifQ==";

export { canonicalPemKey, mangledPemPastes } from "./fixtures/pem-pastes.fixture";
export {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
  WRONG_PRIVATE_KEY,
  WRONG_PUBLIC_KEY,
} from "./fixtures/license-keys.fixture";

/** Valid ENTERPRISE license - signed with TEST_PRIVATE_KEY, expires 2030 */
export const ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAzMC0xMi0zMVQyMzo1OTo1OVoiLCJwbGFuIjp7InR5cGUiOiJFTlRFUlBSSVNFIiwibmFtZSI6IkVudGVycHJpc2UiLCJtYXhNZW1iZXJzIjoxMDAsIm1heFByb2plY3RzIjo1MDAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjEwMDAwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwMDAsIm1heFdvcmtmbG93cyI6MTAwMCwibWF4UHJvbXB0cyI6MTAwMCwibWF4RXZhbHVhdG9ycyI6MTAwMCwibWF4U2NlbmFyaW9zIjoxMDAwLCJtYXhBZ2VudHMiOjEwMDAsIm1heEV4cGVyaW1lbnRzIjoxMDAwLCJtYXhPbmxpbmVFdmFsdWF0aW9ucyI6MTAwMCwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJhRDlLVkx0V2JOT3pGc3JrOUxHQzdhWEZRdk41MDVBR1VHSWVpcXN5S0tYM1IzK3o1aXIrV01lTS9tQVovOVBOeGRDalUrODVLS3A4TFAweDhIcWl0YnRubVprNVhqQ29uNWQ3S1Q3WFhwOWtsd2tEV0VocnNuL2F5ZWlYcWw0eElzUWZMNG92QitaZEt3TFVQUVFucWFGUVhFU093WEt2akp4QzU0VFp6bUk4THBXbSthYk10Qm50VFNxaFVaamRMdkJJWTlVbHR6LzU2T3pvUmgvdlJuSXhleUdlVkJCK3pWaVQ3LzF6YkpGMG5QZ1ZhVW9GUHI1dFRGYzRvS1VPdXRJSjRyWVJPSkFQNUlUbjZ4OHJLSDBXNi9QSmNVeWlHUE9TL085UXhCVXhGWml0Y3R6UDlwZURGeGhxcm5wbGxUdE1iVER6SVprS3gyMWFadDJMRUE9PSJ9";

/**
 * Enterprise license whose term ended (expired 2020-01-01), signed with
 * TEST_PRIVATE_KEY. A genuine license past its end date, which is what proves a
 * lapse keeps the seats and capabilities it sold instead of dissolving into the
 * open-source baseline. See expired-license-enforcement.feature.
 */
export const EXPIRED_ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAyMC0wMS0wMVQwMDowMDowMFoiLCJwbGFuIjp7InR5cGUiOiJFTlRFUlBSSVNFIiwibmFtZSI6IkVudGVycHJpc2UiLCJtYXhNZW1iZXJzIjoxMDAsIm1heFByb2plY3RzIjo1MDAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjEwMDAwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwMDAsIm1heFdvcmtmbG93cyI6MTAwMCwibWF4UHJvbXB0cyI6MTAwMCwibWF4RXZhbHVhdG9ycyI6MTAwMCwibWF4U2NlbmFyaW9zIjoxMDAwLCJtYXhBZ2VudHMiOjEwMDAsIm1heEV4cGVyaW1lbnRzIjoxMDAwLCJtYXhPbmxpbmVFdmFsdWF0aW9ucyI6MTAwMCwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJJMmQ0Vkc4QnJpR1hBbjZWT1ExOER1YmM3M3JuZll1aUpDS1dNK2U3VkdIdkUvRThGU2VhZmpaV2hISEdGQ3NzME80TlFJSkJSOFhYNVQ3RUVSTTNmbTJDTlJYTGN5b0tWMUtrTWlpcVhTU1BEdWxBU1hrT2Q2dUNkWkt0OHNTbW4rbU5EQ0F0N0JoTWU3UmE0c2x6dU0yeUdaWUE5OUFFa2ZQOVhmZUVpSUUybVlsd2JJbWcyUnRwb1lOT0tDYWFlMENkb3E1U1FWcFprdGVtY2dTV1M2YWhPSVExSTIzbE9IVlR1N0ZXOCtDZTVyOVpvYmxXOTVvMVVxdEt6QUdWT2tqS2xkNUN1NGY3THFkT0hIZ2twWlU2aEdMYWE1bFNKd2VBbVI0bUtEWEV5WXBkZDllYUhENGttM2ZLb2YyUFc3V3c3aHpaQlpST1hSTHZLVmtMbmc9PSJ9";

/**
 * Forged license: the payload claims an end date in the past and was never
 * signed with it, so the signature does not check out. Comparing `expiresAt`
 * would call this expired and start metering the seats it invents, which is
 * exactly why the expired verdict follows the signature instead.
 */
export const FORGED_EXPIRED_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiSGFja2VyIENvcnAiLCJlbWFpbCI6ImFkbWluQGFjbWUuY29ycCIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMFoiLCJleHBpcmVzQXQiOiIyMDIwLTAxLTAxVDAwOjAwOjAwWiIsInBsYW4iOnsidHlwZSI6IlBSTyIsIm5hbWUiOiJQcm8iLCJtYXhNZW1iZXJzIjo1LCJtYXhQcm9qZWN0cyI6MTAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjUwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwLCJtYXhXb3JrZmxvd3MiOjI1LCJjYW5QdWJsaXNoIjp0cnVlfX0sInNpZ25hdHVyZSI6IlJTdjJZMjI4c2RJZ041eTZ5SlltTE5vYUVQY2IyVnJjek9YNTVWVDA3SWNIbVlBWW1IYjlZOWhXT1FiR2Z0Q2xFN2pRdkswb1hXamtrUUZzWXZTTXVQVWI3V3kzMkg0YXVEb0NnQWFUTDR2cThhaDAwWG9uNkduUE4zVjZJdkNTZHhPQVFHam1QRzY0MU56U0RxWkJiRC9UQ2h4eEgzOFg1a1ZiZklFUy9jNk1raVVVTCtpVVZZRG9rNU9sNHI5eEprOWNMVlA4cEZTYk5Xa3V1NW8wVFRNR1dzMm1aZGtaRlJQams2VWtQMS9MQXRpS0NCdFNwcnVPZGo1dFBXd3hwSUxpQnhFbkJicW1SUXFiWFEyQkRWRUQySDIrMUNFRXB6Qi9KWUh0U3JHRWdxKzRhU1RxTDhhUmxBME9kU2hqSTdZZXJZcTBKVVZxc0praEJEd3pyZz09In0=";

// =============================================================================
// Invalid format constants (no signing needed)
// =============================================================================

export const MALFORMED_BASE64 = "not-valid-base64!!!";
export const INVALID_JSON_BASE64 = Buffer.from("not json").toString("base64");
export const GARBAGE_DATA = "garbage-data";
