import { z } from "zod";

export const elevenLabsConversationReportSchema = z
  .object({
    status: z.string().optional(),
    metadata: z
      .object({
        call_duration_secs: z.number().optional(),
        cost: z.number().optional(),
        cost_fiat: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ElevenLabsConversationReport = z.infer<typeof elevenLabsConversationReportSchema>;

/** A conversation the vendor has no record of, told apart from one it could not answer for. */
export type ElevenLabsConversationRead = {
  report?: ElevenLabsConversationReport;
  notFound: boolean;
};

/** Reads one brokered conversation back from ElevenLabs with the customer's own key. */
export interface ElevenLabsConversationChannel {
  readConversation(input: {
    apiKey: string;
    baseUrl: string;
    conversationId: string;
    timeoutMs: number;
  }): Promise<ElevenLabsConversationRead>;
}

/** The vendor is on the public internet, as `SSO_DOMAIN_PROOF_PUBLIC_EGRESS` fences its own. */
export const ELEVENLABS_PUBLIC_EGRESS = {
  blockLocal: true,
  allowedHosts: [],
  verifyTls: true,
} as const;
