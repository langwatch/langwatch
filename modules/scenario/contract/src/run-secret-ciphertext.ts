import { z } from "zod";

/**
 * Ciphertext keyed by secret-parameter name.
 *
 * This deliberately does not reuse `runParameterValuesSchema`: ciphertext can
 * exceed the source secret's length and is never a regular run parameter.
 */
export const runSecretCiphertextSchema = z.record(z.string(), z.string());

export type RunSecretCiphertext = z.infer<typeof runSecretCiphertextSchema>;
