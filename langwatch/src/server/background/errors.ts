export class WorkersRestart extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkersRestart";
  }
}
