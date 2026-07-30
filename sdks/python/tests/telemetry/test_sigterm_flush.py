"""Observes the SIGTERM shutdown-flush fix end to end.

CPython installs no default SIGTERM handler, so `atexit.register(...)` alone
never runs when a container sends SIGTERM for a graceful stop — only SIGINT
does, by unwinding through KeyboardInterrupt. Asserting a handler was
registered proves nothing about this; only a real signal delivered to a real
process does. Every test here spawns a child process and sends it an actual
signal via os.kill.
"""

import os
import queue
import signal
import subprocess
import sys
import threading
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

FIXTURES_DIR = Path(__file__).parent / "fixtures"
TIMEOUT = 8.0


def _reader_thread(pipe, line_queue: "queue.Queue[str]") -> threading.Thread:
    def _read():
        for line in iter(pipe.readline, ""):
            line_queue.put(line)
        pipe.close()

    thread = threading.Thread(target=_read, daemon=True)
    thread.start()
    return thread


def _wait_for(line_queue: "queue.Queue[str]", marker: str, collected: list, timeout: float) -> bool:
    remaining = timeout
    while remaining > 0:
        try:
            line = line_queue.get(timeout=remaining)
        except queue.Empty:
            return False
        collected.append(line)
        if marker in line:
            return True
        remaining = timeout
    return False


def test_sigterm_flushes_then_the_process_dies_by_the_signal():
    """Before the fix: no handler at all, so the process dies with no flush
    and (via the default disposition) signal=SIGTERM anyway — the flush is
    what's missing. Reproduced by asserting FLUSHED landed before exit."""
    proc = subprocess.Popen(
        [sys.executable, str(FIXTURES_DIR / "sigterm_flush_host.py")],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    out_q: "queue.Queue[str]" = queue.Queue()
    _reader_thread(proc.stdout, out_q)
    lines: list = []

    try:
        assert _wait_for(out_q, "READY", lines, TIMEOUT), (
            f"host process never became ready; stdout so far={lines!r}"
        )

        proc.send_signal(signal.SIGTERM)

        try:
            proc.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            pytest.fail(
                f"host process did not exit within {TIMEOUT}s of SIGTERM "
                f"(hung instead of dying) — stdout so far={lines!r}"
            )

        # Drain whatever else was buffered after the signal was sent.
        while True:
            try:
                lines.append(out_q.get_nowait())
            except queue.Empty:
                break

        stdout = "".join(lines)
        stderr = proc.stderr.read()

        assert "FLUSHED" in stdout, f"stdout={stdout!r} stderr={stderr!r}"
        assert proc.returncode == -signal.SIGTERM, (
            f"expected the process to die BY SIGTERM (returncode "
            f"-{int(signal.SIGTERM)}), got {proc.returncode}; "
            f"stdout={stdout!r} stderr={stderr!r}"
        )
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def test_sigterm_chains_to_a_handler_the_host_already_installed():
    """The SDK must not clobber a SIGTERM handler the host installed first.
    Proven by observing both markers land, flush before the host handler."""
    proc = subprocess.Popen(
        [sys.executable, str(FIXTURES_DIR / "sigterm_flush_host_with_prior_handler.py")],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    out_q: "queue.Queue[str]" = queue.Queue()
    _reader_thread(proc.stdout, out_q)
    lines: list = []

    try:
        assert _wait_for(out_q, "READY", lines, TIMEOUT), (
            f"host process never became ready; stdout so far={lines!r}"
        )

        proc.send_signal(signal.SIGTERM)

        assert _wait_for(out_q, "HOST_HANDLED", lines, TIMEOUT), (
            f"host handler never ran after SIGTERM (SDK likely clobbered it "
            f"instead of chaining); stdout so far={''.join(lines)!r}"
        )

        stdout = "".join(lines)
        flushed_at = stdout.index("FLUSHED")
        host_handled_at = stdout.index("HOST_HANDLED")
        assert flushed_at < host_handled_at, (
            f"host handler ran before the flush completed; stdout={stdout!r}"
        )
    finally:
        proc.kill()
        proc.wait()


def test_setup_from_a_background_thread_does_not_raise():
    """signal.signal() only works on the main thread and raises ValueError
    elsewhere. A library setup() call from a worker thread must swallow
    that, not propagate it out of the caller's thread."""
    result = subprocess.run(
        [sys.executable, str(FIXTURES_DIR / "sigterm_flush_from_thread_host.py")],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=TIMEOUT,
    )

    assert "SETUP_OK" in result.stdout, (
        f"setup() raised from a background thread; "
        f"stdout={result.stdout!r} stderr={result.stderr!r}"
    )
    assert result.returncode == 0, (
        f"host process exited abnormally; "
        f"stdout={result.stdout!r} stderr={result.stderr!r}"
    )
