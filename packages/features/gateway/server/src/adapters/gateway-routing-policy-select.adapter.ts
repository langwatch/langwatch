/** Shared projection required whenever a virtual key materialises routing policy. */
export const gatewayRoutingPolicySelect = {
  id: true,
  name: true,
  modelAliases: true,
  defaultModel: true,
  policyRules: true,
} as const;
