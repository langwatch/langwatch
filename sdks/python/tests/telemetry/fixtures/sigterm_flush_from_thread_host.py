"""Child-process fixture for test_sigterm_flush.py.

Calls setup() from a background thread. signal.signal() only works on the
main thread and raises ValueError elsewhere; setup() must not let that raise
out of a worker-thread import.
"""

import sys
import threading

import langwatch

errors: list[BaseException] = []


def _setup_from_thread():
    try:
        langwatch.setup(api_key="test-key")
    except BaseException as exc:  # noqa: BLE001 - must observe any raise
        errors.append(exc)


thread = threading.Thread(target=_setup_from_thread)
thread.start()
thread.join()

if errors:
    sys.stdout.write(f"SETUP_RAISED: {errors[0]!r}\n")
else:
    sys.stdout.write("SETUP_OK\n")
sys.stdout.flush()
