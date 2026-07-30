"""Child-process fixture for test_sigterm_flush.py.

Run as a real subprocess (never imported by pytest) so a real SIGTERM can be
observed without killing the pytest process itself. TracerProvider.force_flush
is patched before setup() so a flush call — from the SIGTERM handler or
atexit — prints a marker instead of touching the network.
"""

import sys
import time

from opentelemetry.sdk.trace import TracerProvider

import langwatch


def _mark_flush(self, timeout_millis=30000):
    sys.stdout.write("FLUSHED\n")
    sys.stdout.flush()
    return True


TracerProvider.force_flush = _mark_flush

langwatch.setup(api_key="test-key")

sys.stdout.write("READY\n")
sys.stdout.flush()

# Keep the process alive so it only ever exits via the signal path under
# test, never by the script simply running out of statements.
while True:
    time.sleep(0.05)
