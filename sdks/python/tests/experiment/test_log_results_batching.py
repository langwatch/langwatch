"""
log_results requests are sized by bytes.

The experiment posts to a fake server behind an httpx MockTransport, so the
sizes asserted here are the sizes of the request bodies actually sent.
"""

import json
import time
from typing import Any, Callable, Dict, List, Optional

import httpx
import pytest

from langwatch.batch_evaluation import BatchEvaluation
from langwatch.experiment import experiment as experiment_module
from langwatch.experiment.experiment import BatchEntry, Experiment
from langwatch.utils.log_results_batching import (
    LOG_RESULTS_TARGET_BYTES,
    LogResultsTooLargeError,
    send_log_results_in_parts,
    split_log_results_body,
)

pytestmark = pytest.mark.unit

MB = 1024 * 1024


class FakeLogResultsServer:
    """Records every log_results request and refuses bodies above its limit."""

    def __init__(self, *, limit_bytes: Optional[int] = None) -> None:
        self.limit_bytes = limit_bytes
        self.bodies: List[Dict[str, Any]] = []
        self.sizes: List[int] = []
        self.refused_sizes: List[int] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/evaluations/batch/log_results"
        size = len(request.content)
        if self.limit_bytes is not None and size > self.limit_bytes:
            self.refused_sizes.append(size)
            return httpx.Response(
                413, json={"code": "payload_too_large", "message": "Too large"}
            )
        self.sizes.append(size)
        self.bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"message": "ok"})

    def row_indexes(self) -> List[List[int]]:
        return [[row["index"] for row in body["dataset"]] for body in self.bodies]


@pytest.fixture
def server(monkeypatch) -> Callable[..., FakeLogResultsServer]:
    def start(**options: Any) -> FakeLogResultsServer:
        fake = FakeLogResultsServer(**options)
        monkeypatch.setattr(
            experiment_module,
            "create_client",
            lambda **_: httpx.Client(transport=httpx.MockTransport(fake.handle)),
        )
        return fake

    return start


def _experiment_with_rows(
    row_megabytes: List[int], *, evaluations: bool = True
) -> Experiment:
    """An experiment holding one pending result per row, each with an inline image."""
    experiment = Experiment("image-rows")
    experiment.initialized = True
    experiment.last_sent = time.time() + 100000
    experiment.total = len(row_megabytes)
    experiment.progress = len(row_megabytes)
    for index, megabytes in enumerate(row_megabytes):
        experiment.batch["dataset"].append(
            BatchEntry(
                index=index,
                entry={"image": "x" * (megabytes * MB)},
                duration=10,
                error=None,
                trace_id="",
            )
        )
        if evaluations:
            experiment.log("accuracy", index, score=1.0)
    return experiment


def _send_and_wait(experiment: Experiment, *, finished: bool) -> None:
    experiment._send_batch(finished=finished)
    for thread in experiment.threads:
        thread.join()


class TestGivenABatchLargerThanTheRequestTarget:
    class TestWhenTheExperimentFinishes:
        # @scenario "A log_results batch larger than the request target is sent as several requests"
        def test_sends_several_requests_each_under_the_target(self, server):
            fake = server()
            experiment = _experiment_with_rows([5, 5, 5, 5, 5, 5, 5])

            _send_and_wait(experiment, finished=True)

            assert len(fake.bodies) == 3
            assert all(size <= LOG_RESULTS_TARGET_BYTES + 64 * 1024 for size in fake.sizes)

        # @scenario "Split log_results requests keep the results in their original order"
        def test_keeps_rows_and_evaluations_in_order(self, server):
            fake = server()
            experiment = _experiment_with_rows([5, 5, 5, 5, 5, 5, 5])

            _send_and_wait(experiment, finished=True)

            assert fake.row_indexes() == [[0, 1, 2], [3, 4, 5], [6]]
            evaluations = [
                evaluation["index"]
                for body in fake.bodies
                for evaluation in body["evaluations"]
            ]
            assert evaluations == [0, 1, 2, 3, 4, 5, 6]
            assert {body["run_id"] for body in fake.bodies} == {experiment.run_id}

        # @scenario "Only the last split log_results request marks the run as finished"
        def test_marks_only_the_last_request_as_finished(self, server):
            fake = server()
            experiment = _experiment_with_rows([5, 5, 5, 5, 5, 5, 5])

            _send_and_wait(experiment, finished=True)

            finished = ["finished_at" in body["timestamps"] for body in fake.bodies]
            assert finished == [False, False, True]
            assert all("created_at" in body["timestamps"] for body in fake.bodies)

    class TestWhenTheRunIsStillGoing:
        # @scenario "A split log_results batch of an unfinished run carries no finished marker"
        def test_sends_no_finished_marker(self, server):
            fake = server()
            experiment = _experiment_with_rows([9, 9, 9])

            _send_and_wait(experiment, finished=False)

            assert len(fake.bodies) == 3
            assert not any("finished_at" in body["timestamps"] for body in fake.bodies)


class TestGivenABatchUnderTheRequestTarget:
    # @scenario "A log_results batch under the request target is sent as one request"
    def test_sends_one_request(self, server):
        fake = server()
        experiment = _experiment_with_rows([1, 1, 1])

        _send_and_wait(experiment, finished=True)

        assert fake.row_indexes() == [[0, 1, 2]]
        assert "finished_at" in fake.bodies[0]["timestamps"]


class TestGivenASingleResultLargerThanTheRequestTarget:
    # @scenario "A single result larger than the log_results request target is sent alone"
    def test_sends_it_in_a_request_of_its_own(self, server):
        fake = server()
        experiment = _experiment_with_rows([1, 18, 1])

        _send_and_wait(experiment, finished=True)

        assert fake.row_indexes() == [[0], [1], [2]]
        assert fake.sizes[1] > LOG_RESULTS_TARGET_BYTES


class TestGivenAServerWithALowerRequestLimit:
    class TestWhenItRefusesARequestHoldingSeveralResults:
        # @scenario "A log_results request refused as too large is split and sent again"
        def test_splits_the_request_and_sends_every_result(self, server):
            fake = server(limit_bytes=8 * MB)
            experiment = _experiment_with_rows([3, 3, 3, 3])

            _send_and_wait(experiment, finished=True)

            rows = [index for indexes in fake.row_indexes() for index in indexes]
            evaluations = [
                evaluation["index"]
                for body in fake.bodies
                for evaluation in body["evaluations"]
            ]
            assert rows == [0, 1, 2, 3]
            assert evaluations == [0, 1, 2, 3]
            assert len(fake.refused_sizes) >= 1
            assert all(size <= 8 * MB for size in fake.sizes)
            finished = ["finished_at" in body["timestamps"] for body in fake.bodies]
            assert finished == [False] * (len(fake.bodies) - 1) + [True]

    class TestWhenItRefusesASingleResult:
        # @scenario "A single result the server refuses as too large raises an error naming its size"
        def test_raises_an_error_naming_the_row_and_its_size(self):
            fake = FakeLogResultsServer(limit_bytes=4 * MB)
            client = httpx.Client(transport=httpx.MockTransport(fake.handle))

            def post(part: Dict[str, Any]) -> None:
                client.post(
                    "http://langwatch.test/api/v1/evaluations/batch/log_results",
                    content=json.dumps(part),
                ).raise_for_status()

            body = {
                "run_id": "run_1",
                "dataset": [
                    {"index": 0, "entry": {"image": "x" * MB}},
                    {"index": 1, "entry": {"image": "x" * (6 * MB)}},
                    {"index": 2, "entry": {"image": "x" * MB}},
                ],
                "evaluations": [],
                "timestamps": {"created_at": 1, "finished_at": 2},
            }

            with pytest.raises(LogResultsTooLargeError) as refusal:
                send_log_results_in_parts(body, post=post, target_bytes=3 * MB)

            assert refusal.value.entry_bytes > 6 * MB
            assert "row index 1" in str(refusal.value)
            assert "6.0 MB" in str(refusal.value)
            # The other results are still logged, and the run is still closed.
            assert fake.row_indexes() == [[0], [2]]
            assert "finished_at" in fake.bodies[-1]["timestamps"]

        # @scenario "A refused log_results request is not retried"
        def test_does_not_retry_the_refused_request(self, server):
            fake = server(limit_bytes=4 * MB)
            experiment = _experiment_with_rows([6], evaluations=False)

            _send_and_wait(experiment, finished=True)

            assert len(fake.refused_sizes) == 1


class TestGivenTheLegacyBatchEvaluation:
    # @scenario "The legacy batch evaluation splits a large log_results batch the same way"
    def test_splits_the_batch_by_bytes(self):
        parts = split_log_results_body(
            {
                "experiment_slug": "legacy",
                "run_id": "run_1",
                "dataset": [
                    {"index": index, "entry": {"image": "x" * (7 * MB)}}
                    for index in range(4)
                ],
                "evaluations": [],
                "settings": {"a": 1},
                "timestamps": {"created_at": 1, "finished_at": 2},
            }
        )

        assert [[row["index"] for row in part["dataset"]] for part in parts] == [
            [0, 1],
            [2, 3],
        ]
        assert [part["timestamps"] for part in parts] == [
            {"created_at": 1},
            {"created_at": 1, "finished_at": 2},
        ]
        assert all(part["settings"] == {"a": 1} for part in parts)
        assert BatchEvaluation.post_results_in_parts is not None
