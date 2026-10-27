/**
 * A license minted by origin/main (fe824f34d4) before Connect existed, with the arguments
 * its generate-license script passed, and the public half of the key it was signed with.
 * gitleaks:allow -- a test public key and a license signed with it, not real secrets.
 */
export const OFFLINE_LICENSE_FROM_MAIN = {
  productionPublicKey:
    "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvyNNiu5B0lretFaxowsu\nfM907tHWnBITXVDfnpPAwUgzrODdjfTt73XW1S+EDd8AM0FzOpx0YolXipS4+SNK\naxSXwNO0S0XjJGLW7wz9Nv8/PP9V23LtiLQQOj8eGol/texr5pIZy2CRjVeEYcBZ\nGCNz8mT/4tEM8v/NaoTFngsRwNJTuRlro+MZF7eArdBmtIU1fNLchZEH2kojMHKj\n8vMIyZoTXB4TF/9iXL40eJQUWrVM1llGzJrZ7GhD3lIeyiZz+cQvako1BIthRuUa\n2qLWpbVP63RSjxphslVvXk1RycL3esr2cj0Pe8loWxeKoxWjnXdLJYWygQh8aUbZ\niQIDAQAB\n-----END PUBLIC KEY-----",
  publicKey:
    "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvSRFSt6cAujxnUAjxrBm\nm5yHJLQObY96nCu73TnLKzPaqu2fTjol86yOHQ8Be3Dknt8HYBQlVn4sZRaJEuX9\n1MHwcqOlxe1pHDUcmm87GlscvgtAE2xolE036vSkwaKkjepsT9CqMiU+rp1OFlq8\nJ1lAWuVT4SUHvjHLC8Px3VHrfa377KYNx+gq0vBh5qnAV/XBHoGTzoSqlfSJUZCC\nUM6f5f75yNGmRF63RM9wr7EacXZytopJkeNG+mFAILmxCmNo0xEvsyjHSZldyd2p\necxOlv8RW+Yen//MP0IXfCiBmkY8a6E51G9Wh3wo2HcAytgrTXWSTNWJybZu/laV\nkQIDAQAB\n-----END PUBLIC KEY-----\n",
  licenseKey:
    "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy1lNzk5NmIyMy0yY2VkLTQ1OTQtYmIzOS1mYzVkOGIyMzcyNTciLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQUNNRSBPZmZsaW5lIiwiZW1haWwiOiJvcHNAYWNtZS1vZmZsaW5lLnRlc3QiLCJpc3N1ZWRBdCI6IjIwMjYtMDktMTlUMTA6MDM6MjIuNzc3WiIsImV4cGlyZXNBdCI6IjIwMzEtMDEtMDFUMDA6MDA6MDAuMDAwWiIsInBsYW4iOnsidHlwZSI6IkVOVEVSUFJJU0UiLCJuYW1lIjoiRW50ZXJwcmlzZSIsIm1heE1lbWJlcnMiOjEyLCJtYXhNZW1iZXJzTGl0ZSI6NCwibWF4UHJvamVjdHMiOjkwMDcxOTkyNTQ3NDA5OTEsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjEwMDAwMDAwLCJtYXhXb3JrZmxvd3MiOjkwMDcxOTkyNTQ3NDA5OTEsImNhblB1Ymxpc2giOnRydWUsIndlYmhvb2tFbmRwb2ludHNFbmFibGVkIjp0cnVlLCJ1c2FnZVVuaXQiOiJ0cmFjZXMifX0sInNpZ25hdHVyZSI6Ik9uRk9BdFh1bG1nY1ltRWNDb0dpN3hGc3ZnTTVlTVBUTkFPVUNhbXRCQmFYM04wYlNpTDZsc2FHVTI3WDU3YVJPUzZGZU94cGpoTDVuaDNJaFVZTW9tMG14N1cxYUZxY2pkUUZmZ3BaMEJXd3pIdkozUUNxb1BERXJtNG02ZmQ0QUVsYVpEQ1hOL21oVS9MQ2ZOSkFVU09tWnJnam9MeUxkUDFpbkxRWlQ1YnRJeTVMSENTM2ZIeXIwck1UZkxhc2k4UGhzRzZsSEpXaHZiS3k2RW52OUExZWZNMlVyM21xcDJieUcwakFObkhBbk1jczdyNWhWbFRUNHU2RGlwZEF4T3VTdmF6WXJsTERYNVFnSVZ1c3Z0UElNbWx5TmdYRzJBTmpuZmtYSmJvNEVuYXNMRHJwaGc3a29SVSt2QnA1Sk1md3prZkE2Y2JQWmYrU2dBOTV2QT09In0=",
  expected: {
    licenseId: "lic-e7996b23-2ced-4594-bb39-fc5d8b237257",
    version: 1,
    organizationName: "ACME Offline",
    email: "ops@acme-offline.test",
    issuedAt: "2026-09-19T10:03:22.777Z",
    expiresAt: "2031-01-01T00:00:00.000Z",
    plan: {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 12,
      maxMembersLite: 4,
      maxProjects: 9007199254740991,
      maxMessagesPerMonth: 10000000,
      maxWorkflows: 9007199254740991,
      canPublish: true,
      webhookEndpointsEnabled: true,
      usageUnit: "traces",
    },
  },
} as const;
