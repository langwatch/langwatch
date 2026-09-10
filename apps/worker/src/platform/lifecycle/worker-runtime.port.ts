export abstract class WorkerHandle {
  abstract shutdown(): Promise<void>;
}

export abstract class WorkerLifecycle {
  abstract close(): Promise<void>;
}

export abstract class WorkerTransport {
  abstract start(): Promise<WorkerHandle>;
}
