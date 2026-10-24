"""Adapts the WASI interpreter before user code runs. Imported by runner.py
only where it exists, which is the wasm runtime's read-only /runner mount."""

from __future__ import annotations

import importlib.machinery
import os
import selectors
import sys
import time

import _lw_host

# Relative paths resolve inside the run's own directory, as in a subprocess.
os.chdir(os.environ.get("TMPDIR") or "/work")


def _sleep(seconds):
    # The guest's clock_nanosleep is unsupported; the engine sleeps instead,
    # and stops sleeping when the run's time is up.
    if seconds < 0:
        raise ValueError("sleep length must be non-negative")
    if seconds:
        _lw_host.call("sleep", seconds=float(seconds))


time.sleep = _sleep


class HostSelector(selectors.BaseSelector):
    """An event-loop selector with nothing to watch: a guest has no sockets,
    so waiting is only ever waiting for time, which the engine does."""

    def __init__(self):
        self._map = {}

    def register(self, fileobj, events, data=None):
        raise OSError("a code block has no file descriptors to wait on")

    def unregister(self, fileobj):
        raise KeyError(fileobj)

    def select(self, timeout=None):
        if timeout is None:
            raise RuntimeError("the event loop is waiting on nothing and would never wake")
        _sleep(max(timeout, 0))
        return []

    def close(self):
        pass

    def get_map(self):
        return self._map


selectors.DefaultSelector = HostSelector


def _patch_selector_events(module):
    # The self-pipe wakes a loop from another thread; a guest has no threads.
    loop = module.BaseSelectorEventLoop
    loop._make_self_pipe = lambda self: None
    loop._close_self_pipe = lambda self: None
    loop._write_to_self = lambda self: None


_AFTER_IMPORT = {"asyncio.selector_events": _patch_selector_events}


class _PatchAfterImport:
    """Patches a stdlib module as it is first imported, so runs that never
    import asyncio never pay for it."""

    @staticmethod
    def find_spec(name, path, target=None):
        patch = _AFTER_IMPORT.get(name)
        if patch is None:
            return None
        spec = importlib.machinery.PathFinder.find_spec(name, path)
        if spec is None or spec.loader is None:
            return spec
        original = spec.loader.exec_module

        def exec_module(module):
            original(module)
            patch(module)

        spec.loader.exec_module = exec_module
        return spec


sys.meta_path.insert(0, _PatchAfterImport)
