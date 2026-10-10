/** The loader is told what a task is; this stands in for `@langwatch/task`'s `Task`. */
export class FixtureTask {
  constructor(readonly name: string) {}
}
