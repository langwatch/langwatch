export class LangySessionKeyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangySessionKeyScopeError";
  }
}
