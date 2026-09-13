"""Test thread safety of KSUID generation."""

import threading
from typing import List

from ksuid import Instance, InstanceScheme, Node, generate, parse


def test_thread_safety():
    """Test that KSUID generation is thread-safe."""
    # Create a custom node for testing
    test_instance = Instance(InstanceScheme.RANDOM, bytes([1, 2, 3, 4, 5, 6, 7, 8]))
    from ksuid import Ksuid

    node = Node(
        "test",
        test_instance,
        lambda env, res, ts, inst, seq: Ksuid(env, res, ts, inst, seq),
    )

    # Generate KSUIDs from multiple threads
    ksuids: List[str] = []
    lock = threading.Lock()

    def generate_ksuid():
        ksuid = node.generate("test")
        with lock:
            ksuids.append(str(ksuid))

    # Create and start multiple threads
    threads = []
    for _ in range(10):
        thread = threading.Thread(target=generate_ksuid)
        threads.append(thread)
        thread.start()

    # Wait for all threads to complete
    for thread in threads:
        thread.join()

    # Verify all KSUIDs are unique
    assert len(ksuids) == 10
    assert len(set(ksuids)) == 10

    # Verify they all have the same timestamp (generated at roughly the same time)
    timestamps = []
    for ksuid_str in ksuids:
        ksuid = parse(ksuid_str)  # Using global parse function
        timestamps.append(ksuid.timestamp)

    # All timestamps should be the same (within 1 second)
    assert max(timestamps) - min(timestamps) <= 1

    # Verify sequence IDs are unique and sequential
    sequence_ids = []
    for ksuid_str in ksuids:
        ksuid = parse(ksuid_str)  # Using global parse function
        sequence_ids.append(ksuid.sequence_id)

    # Sequence IDs should be unique and in range
    assert len(set(sequence_ids)) == 10
    assert min(sequence_ids) >= 0
    assert max(sequence_ids) < 10


def test_concurrent_generate_calls():
    """Test concurrent calls to the global generate function."""
    ksuids: List[str] = []
    lock = threading.Lock()

    def generate_ksuid():
        ksuid = generate("concurrenttest")
        with lock:
            ksuids.append(str(ksuid))

    # Create and start multiple threads
    threads = []
    for _ in range(20):
        thread = threading.Thread(target=generate_ksuid)
        threads.append(thread)
        thread.start()

    # Wait for all threads to complete
    for thread in threads:
        thread.join()

    # Verify all KSUIDs are unique
    assert len(ksuids) == 20
    assert len(set(ksuids)) == 20


def test_high_concurrency():
    """Test high concurrency scenario."""
    ksuids: List[str] = []
    lock = threading.Lock()

    def generate_ksuid():
        ksuid = generate("highconcurrency")
        with lock:
            ksuids.append(str(ksuid))

    # Create many threads for high concurrency
    threads = []
    for _ in range(100):
        thread = threading.Thread(target=generate_ksuid)
        threads.append(thread)
        thread.start()

    # Wait for all threads to complete
    for thread in threads:
        thread.join()

    # Verify all KSUIDs are unique
    assert len(ksuids) == 100
    assert len(set(ksuids)) == 100

    # Verify no duplicates
    ksuid_set = set(ksuids)
    assert len(ksuid_set) == len(ksuids)


if __name__ == "__main__":
    # Run the tests
    test_thread_safety()
    test_concurrent_generate_calls()
    test_high_concurrency()
    print("All thread safety tests passed!")
