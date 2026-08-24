export type UnsubscribeTokenPayload = {
	projectId: string;
	triggerId: string | null;
	email: string;
};
export abstract class UnsubscribeTokenVerifier {
	abstract tryVerify(token: string): UnsubscribeTokenPayload | null;
}
