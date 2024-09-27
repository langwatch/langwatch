import multiprocessing
from multiprocessing import Event, Queue
from multiprocessing.synchronize import Event as EventType
import resource
import threading
import queue
import time
from typing import Callable, Generic, TypeVar

import psutil

from langwatch_nlp.studio.types.events import Error, ErrorPayload

T = TypeVar("T")
U = TypeVar("U")


class IsolatedProcessPool(Generic[T, U]):
    def __init__(
        self,
        worker: "Callable[[EventType, Queue[T | None], Queue[U]], None]",
        size=4,
        max_memory_mb=4096,
        max_cpu_percent=300,
    ):
        self.worker = worker
        self.size = size
        self.max_memory_mb = max_memory_mb
        self.max_cpu_percent = max_cpu_percent

        self.idle_processes: (
            "list[tuple[multiprocessing.Process, Queue[T | None], Queue[U]]]"
        ) = []
        self.running = True
        self.fill_thread = threading.Thread(target=self._fill_pool_continuously)
        self.fill_thread.daemon = True
        self.fill_thread.start()

    def _monitor_process(self, process: multiprocessing.Process, queue_out: Queue):
        p = psutil.Process(process.pid)
        while process.is_alive():
            try:
                memory_usage = p.memory_info().rss / (1024 * 1024)  # Convert to MB
                cpu_usage = p.cpu_percent(interval=1)

                if (
                    memory_usage > self.max_memory_mb
                    or cpu_usage > self.max_cpu_percent
                ):
                    print(f"Process {process.pid} exceeded limits. Terminating.")
                    process.terminate()
                    process.join()
                    queue_out.put(
                        Error(
                            payload=ErrorPayload(
                                message=f"Process {process.pid} exceeded limits. Terminating."
                            )
                        )
                    )
                    break

                time.sleep(1)  # Check every second
            except psutil.NoSuchProcess:
                break  # Process has already terminated

    def _create_process(self):
        queue_in: "Queue[T | None]" = Queue()
        queue_out: "Queue[U]" = Queue()
        ready_event = Event()
        p = multiprocessing.Process(
            target=self.worker, args=(ready_event, queue_in, queue_out)
        )
        p.start()

        # Start monitoring thread
        monitor_thread = threading.Thread(
            target=self._monitor_process, args=(p, queue_in)
        )
        monitor_thread.daemon = True
        monitor_thread.start()

        return p, queue_in, queue_out, ready_event

    def _fill_pool_continuously(self):
        while self.running:
            if len(self.idle_processes) < self.size:
                process_creations = [
                    self._create_process()
                    for _ in range(self.size - len(self.idle_processes))
                ]
                for process, queue_in, queue_out, ready_event in process_creations:
                    ready_event.wait()
                    self.idle_processes.append((process, queue_in, queue_out))
            else:
                time.sleep(0.1)

    def submit(self, event: T) -> tuple[multiprocessing.Process, "Queue[U]"]:
        start_time = time.time()
        while True:
            try:
                process, queue_in, queue_out = self.idle_processes.pop()
                break
            except IndexError:
                if not self.running:
                    raise RuntimeError("Pool is shutting down")
                elif time.time() - start_time > 10:
                    raise RuntimeError(
                        "Timeout while waiting for a process to become available"
                    )
                else:
                    time.sleep(0.1)

        queue_in.put(event)
        return process, queue_out

    def shutdown(self):
        self.running = False
        self.fill_thread.join()

        while len(self.idle_processes) > 0:
            process, queue_in, _ = self.idle_processes.pop()
            queue_in.put(None)  # Send exit sentinel
            process.join()
