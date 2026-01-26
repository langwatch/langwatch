// gitleaks:allow — test fixture keys only (not real secrets)
/**
 * Test license fixtures - pre-generated static constants.
 * License generation logic stays in lw-saas only.
 */
import type { LicenseData } from "../../types";

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

/** Valid ENTERPRISE license - signed with TEST_PRIVATE_KEY, expires 2030 */
export const ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAzMC0xMi0zMVQyMzo1OTo1OVoiLCJwbGFuIjp7InR5cGUiOiJFTlRFUlBSSVNFIiwibmFtZSI6IkVudGVycHJpc2UiLCJtYXhNZW1iZXJzIjoxMDAsIm1heFByb2plY3RzIjo1MDAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjEwMDAwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwMDAsIm1heFdvcmtmbG93cyI6MTAwMCwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJXSzR3NU5lQXcyMUQvOXNoemJLMWk0T2o0Mm5XNjhpOTA1bUZFTmJJMGJmQkJQY1BQdWpzN2VkQzIvZXZVNWlsVXJRcnp4NHRCRm9CMWlIZW1hdjJSMjhNRHZRWWRZTXh1eW54RmZiNTNVNnA0Z1c2Mzc0QXBzU0hLYXZ0dTg4MVpsbjlvZnBoaVZuQ1FiZlBnVHNQd051RlpJZFA0WnZQRi80YitRMms0NWFJVFZDTkpyb3JHdDl2Qk9kU2ZqNmF5WVVoMElTVTdncENNT21QV1dEVkZXRmRLTzU3d04zL0NpQzdoSUs4ellzemNNVDNicG8remhIdWxjWWVMcFBJQmMxQW0wNFVlSFcxcVVaMEZBWmNRWDFjMzBTQUdhTDJjamV6OHNCOFh5VzBLWDZaSDZ2d3p1UUgzdUU2UHdWeGJYY2pTNUdaZ3FwU2d0a3cyRUZPL3c9PSJ9";

// =============================================================================
// Invalid format constants (no signing needed)
// =============================================================================

export const MALFORMED_BASE64 = "not-valid-base64!!!";
export const INVALID_JSON_BASE64 = Buffer.from("not json").toString("base64");
export const GARBAGE_DATA = "garbage-data";
