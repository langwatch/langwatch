export type UnsubscribeTokenPayload = {
  projectId: string;
  triggerId: string | null;
  email: string;
};
export abstract class UnsubscribeTokenVerifierPort {
  abstract tryVerify(token: string): UnsubscribeTokenPayload | null;
}
