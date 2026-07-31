"""Child-process fixture for test_sigterm_flush.py.

Installs a SIGTERM handler *before* langwatch.setup() runs, the way a host
application would. Proves the SDK chains to that handler instead of
replacing it: on SIGTERM it must flush, then hand off to the host handler.
"""

import signal
import sys
import time

from opentelemetry.sdk.trace import TracerProvider

import langwatch


def _mark_flush(self, timeout_millis=30000):
    sys.stdout.write("FLUSHED\n")
    sys.stdout.flush()
    return True


TracerProvider.force_flush = _mark_flush


def _host_handler(signum, frame):
    sys.stdout.write("HOST_HANDLED\n")
    sys.stdout.flush()


signal.signal(signal.SIGTERM, _host_handler)

langwatch.setup(api_key="test-key")

sys.stdout.write("READY\n")
sys.stdout.flush()

while True:
    time.sleep(0.05)
