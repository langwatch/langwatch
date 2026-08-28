export abstract class WorkerHandlePort {
  abstract shutdown(): Promise<void>;
}

export abstract class WorkerLifecyclePort {
  abstract close(): Promise<void>;
}

export abstract class WorkerTransportPort {
  abstract start(): Promise<WorkerHandlePort>;
}
