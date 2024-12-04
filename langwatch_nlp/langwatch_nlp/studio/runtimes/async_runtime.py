import asyncio
from asyncio import Queue
import os
import sys
from typing import Any
from contextlib import asynccontextmanager

from fastapi import FastAPI

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


class AsyncRuntime(BaseRuntime[asyncio.Task]):
    def __init__(self):
        pass

    @asynccontextmanager
    async def lifespan(self, app: FastAPI):
        yield

    def shutdown_handler(self, sig, frame):
        sys.exit(0)

    def forceful_exit(self):
        print("Forceful exit triggered", file=sys.stderr)
        os._exit(1)

    async def submit(
        self, event: StudioClientEvent
    ) -> tuple[Any, "Queue[StudioServerEvent]"]:
        queue_out: Queue[StudioServerEvent] = Queue()

        async def process_events():
            try:
                async for event_ in execute_event(event, queue_out):
                    queue_out.put_nowait(event_)
            except Exception as e:
                queue_out.put_nowait(Error(payload=ErrorPayload(message=repr(e))))

        task = asyncio.create_task(process_events())

        trace_id = get_trace_id(event)
        if trace_id and trace_id not in self.running_processes:
            self.running_processes[trace_id] = RunningProcess(
                process=task, queue=queue_out
            )

        return task, queue_out

    async def stop_process(self, trace_id: str):
        queue_out = self.running_processes[trace_id]["queue"]
        queue_out.put(Done())

        await asyncio.sleep(0.2)

        # Check again because the process generally finishes gracefully on its own
        if trace_id in self.running_processes:
            task = self.running_processes[trace_id]["process"]
            task.cancel()
            del self.running_processes[trace_id]

    def kill_process(self, process: asyncio.Task):
        process.cancel()

    def is_process_alive(self, process: asyncio.Task) -> bool:
        return not process.done()
