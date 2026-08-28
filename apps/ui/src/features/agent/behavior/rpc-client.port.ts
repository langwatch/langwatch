/** Minimal RPC transport used by Agent browser adapters. */
export abstract class RpcClientPort {
  abstract query(path: string, input: unknown): Promise<unknown>;

  abstract mutate(path: string, input: unknown): Promise<unknown>;
}
