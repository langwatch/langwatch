"""
API facade for test suites, the groups that hold agent test scenarios.

A test suite is a name and the scenarios filed under it. Running one is sugar
over a run plan: the caller sends the targets, and the platform derives the
plan name from the suite and the target unless the caller names the plan
itself.

Uses httpx via the generated REST API client for HTTP transport.

Spec: specs/python-sdk/run-plans-and-test-suites.feature
"""

from typing import Any, Dict, List, Optional

import httpx

from langwatch.generated.langwatch_rest_api_client.client import (
    Client as LangWatchRestApiClient,
)
from langwatch.state import get_instance
from langwatch.utils.gateway_http import quote_path_segment, raise_for_status
from langwatch.utils.initialization import ensure_setup
from langwatch.utils.run_inputs import build_run_inputs

TEST_SUITES_PATH = "/api/v1/test-suites"


class TestSuitesFacade:
    """Facade for the project's test suites: list, create, read, rename,
    archive and run."""

    __test__ = False
    """Keeps pytest from trying to collect this class as a test. The name
    starts with ``Test``, so importing it into a test module otherwise raises
    a collection warning on every run."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "TestSuitesFacade":
        """Build the facade on the process-wide LangWatch client, setting it
        up first if nothing has yet."""
        ensure_setup()
        instance = get_instance()
        if instance is None:
            raise RuntimeError(
                "LangWatch client has not been initialized. Call setup() first."
            )
        return cls(instance.rest_api_client)

    def _http(self) -> httpx.Client:
        return self._client.get_httpx_client()

    def list(self) -> Any:
        """Every test suite of the project.

        Returns:
            The list of test suites.
        """
        response = self._http().get(TEST_SUITES_PATH)
        raise_for_status(response, operation="list test suites")
        return response.json()

    def create(self, *, name: str) -> Dict[str, Any]:
        """Create an empty test suite.

        Args:
            name: What to call it.

        Returns:
            Dictionary containing the created test suite.
        """
        response = self._http().post(TEST_SUITES_PATH, json={"name": name})
        raise_for_status(response, operation="create test suite")
        return response.json()

    def get(self, test_suite_id: str) -> Dict[str, Any]:
        """One test suite, with the scenarios filed under it.

        Args:
            test_suite_id: The test suite to read.

        Returns:
            Dictionary containing the test suite and its scenarios.
        """
        response = self._http().get(
            f"{TEST_SUITES_PATH}/{quote_path_segment(test_suite_id)}"
        )
        raise_for_status(response, operation="get test suite")
        return response.json()

    def rename(self, test_suite_id: str, *, name: str) -> Dict[str, Any]:
        """Give a test suite a new name.

        Args:
            test_suite_id: The test suite to rename.
            name: The new name.

        Returns:
            Dictionary containing the updated test suite.
        """
        response = self._http().patch(
            f"{TEST_SUITES_PATH}/{quote_path_segment(test_suite_id)}",
            json={"name": name},
        )
        raise_for_status(response, operation="rename test suite")
        return response.json()

    def archive(self, test_suite_id: str) -> Dict[str, Any]:
        """Archive a test suite, taking it out of the lists without deleting
        the scenarios filed under it.

        Args:
            test_suite_id: The test suite to archive.

        Returns:
            Dictionary with the suite id and its archived state.
        """
        response = self._http().delete(
            f"{TEST_SUITES_PATH}/{quote_path_segment(test_suite_id)}"
        )
        raise_for_status(response, operation="archive test suite")
        return response.json()

    def run(
        self,
        test_suite_id: str,
        *,
        targets: List[Dict[str, Any]],
        name: Optional[str] = None,
        repeat_count: Optional[int] = None,
        simulator_model: Optional[str] = None,
        judge_model: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        note: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run every scenario filed under a test suite.

        Args:
            test_suite_id: The test suite to run.
            targets: What to run the scenarios against, as
                ``{"type": "prompt"|"http"|"code"|"workflow", "referenceId": ...}``.
            name: The run plan's name. Left out, the platform derives it from
                the suite name and the target name.
            repeat_count: How many times to run each scenario, 1 to 5.
            simulator_model: The model that plays the user.
            judge_model: The model that grades the run.
            parameters: Constants applied to every scenario in the run, e.g.
                ``{"account_tier": "gold"}``. A value here overrides the
                scenario's own default for that name.
            note: One short line saying why this ran, up to 200 characters.
            idempotency_key: Repeat it to make a retry join the first run
                rather than start a second one.

        Returns:
            Dictionary with the run result and the plan it belongs to.
        """
        body: Dict[str, Any] = {"targets": list(targets)}
        if name is not None:
            body["name"] = name
        if repeat_count is not None:
            body["repeatCount"] = repeat_count
        if simulator_model is not None:
            body["simulatorModel"] = simulator_model
        if judge_model is not None:
            body["judgeModel"] = judge_model
        body.update(
            build_run_inputs(
                parameters=parameters, note=note, idempotency_key=idempotency_key
            )
        )

        response = self._http().post(
            f"{TEST_SUITES_PATH}/{quote_path_segment(test_suite_id)}/run",
            json=body,
        )
        raise_for_status(response, operation="run test suite")
        return response.json()
