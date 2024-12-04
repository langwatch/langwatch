from typing import Dict, Generic, Optional, TypeVar, TypedDict, Union
import asyncio
import multiprocessing

from langwatch_nlp.studio.types.events import StudioClientEvent, StudioServerEvent


T = TypeVar("T")

ServerEventQueue = Union[
    "asyncio.Queue[StudioServerEvent]", "multiprocessing.Queue[StudioServerEvent]"
]


class RunningProcess(TypedDict, Generic[T]):
    process: T
    queue: ServerEventQueue


class BaseRuntime(Generic[T]):
    running_processes: Dict[str, RunningProcess[T]] = {}

    def __init__(self):
        pass

    async def startup(self):
        pass

    async def shutdown(self):
        pass

    async def submit(self, event: StudioClientEvent) -> tuple[
        T,
        ServerEventQueue,
    ]:
        raise NotImplementedError

    async def stop_process(self, trace_id: str):
        raise NotImplementedError

    def kill_process(self, process: T):
        raise NotImplementedError

    def is_process_alive(self, process: T) -> bool:
        raise NotImplementedError

    def cleanup(self, trace_id: Optional[str], process: T):
        if self.is_process_alive(process):
            self.kill_process(process)

        if trace_id and trace_id in self.running_processes:
            del self.running_processes[trace_id]
