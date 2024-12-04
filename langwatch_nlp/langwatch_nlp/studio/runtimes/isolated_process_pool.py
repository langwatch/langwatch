import asyncio
import multiprocessing
from multiprocessing import Event, Queue, Process
from multiprocessing.synchronize import Event as EventType
import os
import queue
import signal
import sys
import threading
import time
from typing import Callable, Generic, TypeVar

from langwatch_nlp.studio.execute.execute_event import execute_event
from langwatch_nlp.studio.runtimes.base_runtime import BaseRuntime, RunningProcess
from langwatch_nlp.studio.types.events import (
    Done,
    Error,
    ErrorPayload,
    StudioClientEvent,
    StudioServerEvent,
    get_trace_id,
)
from langwatch_nlp.studio.utils import shutdown_handler

T = TypeVar("T")
U = TypeVar("U")


class IsolatedProcessPoolRuntime(BaseRuntime[Process]):
    def __init__(self):
        pass

    async def startup(self):
        global pool
        pool = IsolatedProcessPool(self.event_worker, size=4)

    async def shutdown(self):
        pool.shutdown()

    async def submit(
        self, event: StudioClientEvent
    ) -> tuple[Process, "Queue[StudioServerEvent]"]:
        process, queue = await pool.submit(event)

        trace_id = get_trace_id(event)
        if trace_id and trace_id not in self.running_processes:
            self.running_processes[trace_id] = RunningProcess(
                process=process, queue=queue
            )

        return process, queue

    def event_worker(
        self,
        ready_event: EventType,
        queue_in: "Queue[StudioClientEvent | None]",
        queue_out: "Queue[StudioServerEvent]",
    ):
        ready_event.set()
        signal.signal(signal.SIGUSR1, shutdown_handler)
        while True:
            try:
                event = queue_in.get(timeout=1)
                if event is None:  # Sentinel to exit
                    break
                try:

                    async def async_execute_event(event):
                        async for event_ in execute_event(event, queue_out):
                            queue_out.put(event_)

                    asyncio.run(async_execute_event(event))
                except Exception as e:
                    queue_out.put(Error(payload=ErrorPayload(message=repr(e))))
            except queue.Empty:
                continue

    async def stop_process(self, trace_id: str):
        queue = self.running_processes[trace_id]["queue"]
        queue.put(Done())

        await asyncio.sleep(0.2)

        # Check again because the process generally finishes gracefully on its own
        if trace_id in self.running_processes:
            process = self.running_processes[trace_id]["process"]
            self.kill_process(process)

            del self.running_processes[trace_id]

    def kill_process(self, process: Process):
        if process.pid is None:
            return
        if not process.is_alive():
            return
        os.kill(process.pid, signal.SIGUSR1)

    def is_process_alive(self, process: Process) -> bool:
        return process.is_alive()


class IsolatedProcessPool(Generic[T, U]):
    def __init__(
        self,
        worker: "Callable[[EventType, Queue[T | None], Queue[U]], None]",
        size=4,
    ):
        self.worker = worker
        self.size = size

        self.idle_processes: (
            "list[tuple[multiprocessing.Process, Queue[T | None], Queue[U]]]"
        ) = []
        self.running = True
        self.fill_thread = threading.Thread(target=self._fill_pool_continuously)
        self.fill_thread.daemon = True
        self.fill_thread.start()

    def _create_process(self):
        queue_in: "Queue[T | None]" = Queue()
        queue_out: "Queue[U]" = Queue()
        ready_event = Event()
        p = multiprocessing.Process(
            target=self.worker,
            args=(ready_event, queue_in, queue_out),
        )
        p.start()
        return p, queue_in, queue_out, ready_event

    def _fill_pool_continuously(self):
        while self.running:
            if len(self.idle_processes) < self.size:
                print(
                    f"[ProcessPool] Creating {self.size - len(self.idle_processes)} processes"
                )
                sys.stdout.flush()
                process_creations = [
                    self._create_process()
                    for _ in range(self.size - len(self.idle_processes))
                ]
                for process, queue_in, queue_out, ready_event in process_creations:
                    ready_event.wait()
                    print(f"[ProcessPool] Process ready")
                    sys.stdout.flush()
                    self.idle_processes.append((process, queue_in, queue_out))
            else:
                time.sleep(0.1)

    async def submit(self, event: T) -> tuple[multiprocessing.Process, "Queue[U]"]:
        start_time = time.time()
        while True:
            try:
                process, queue_in, queue_out = self.idle_processes.pop(0)
                print(f"[ProcessPool] Process popped")
                sys.stdout.flush()
                break
            except IndexError:
                print(f"[ProcessPool] No idle processes, waiting for new one")
                sys.stdout.flush()
                if not self.running:
                    raise RuntimeError("Pool is shutting down")
                elif time.time() - start_time > 10:
                    raise RuntimeError(
                        "Timeout while waiting for a process to become available"
                    )
                else:
                    await asyncio.sleep(0.1)

        queue_in.put(event)
        return process, queue_out

    def shutdown(self):
        self.running = False
        self.fill_thread.join()

        while len(self.idle_processes) > 0:
            process, queue_in, _ = self.idle_processes.pop()
            queue_in.put(None)  # Send exit sentinel
            process.join()
