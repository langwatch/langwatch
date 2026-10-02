/**
 * What a mounted ops declaration reads off the request: who is asking. The
 * operator gate is not in the members - it is the application's, changed via
 * `opsOperator`.
 */
export type OpsTrpcTestContext = { actor: { id: string } };
