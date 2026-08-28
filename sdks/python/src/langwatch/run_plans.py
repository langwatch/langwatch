"""
API facade for run plans, the named configurations agent test runs execute under.

A run plan is a name plus a configuration: the scope of cases to run, the
targets to run them against, the repeat count and the two simulation models.
The name is the identity, so running under the name of an existing plan
replaces that plan's configuration and running under a new name creates one.

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
from langwatch.utils.run_inputs import build_run_inputs, build_scope

RUN_PLANS_PATH = "/api/v1/run-plans"

class RunPlansFacade:
    """Facade for the project's run plans: run, re-run, list, read, archive."""

    def __init__(self, rest_api_client: LangWatchRestApiClient) -> None:
        self._client = rest_api_client

    @classmethod
    def from_global(cls) -> "RunPlansFacade":
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

    def run(
        self,
        *,
        targets: List[Dict[str, Any]],
        name: Optional[str] = None,
        scope: str = "all",
        folder_ids: Optional[List[str]] = None,
        labels: Optional[List[str]] = None,
        scenario_ids: Optional[List[str]] = None,
        repeat_count: Optional[int] = None,
        simulator_model: Optional[str] = None,
        judge_model: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        note: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Start a run, creating or replacing the plan the name resolves to.

        Args:
            targets: What to run the cases against, as
                ``{"type": "prompt"|"http"|"code"|"workflow", "referenceId": ...}``.
            name: The plan's name. A name already in use replaces that plan's
                configuration; a new one creates a plan. Left out, the platform
                names the plan itself.
            scope: What the plan covers: ``all``, ``folders``, ``labels`` or
                ``cases``. Every mode but ``all`` needs its own list.
            folder_ids: The test suites to run, for ``scope="folders"``.
            labels: The labels the cases carry, for ``scope="labels"``.
            scenario_ids: The cases to run, for ``scope="cases"``.
            repeat_count: How many times to run each case, 1 to 5.
            simulator_model: The model that plays the user.
            judge_model: The model that grades the run.
            parameters: Constants applied to every case in the run, e.g.
                ``{"account_tier": "gold"}``. A value here overrides the case's
                own default for that name.
            note: One short line saying why this ran, up to 200 characters.
            idempotency_key: Repeat it to make a retry join the first run
                rather than start a second one.

        Returns:
            Dictionary with the run result, the plan it belongs to and whether
            the plan was created.
        """
        config: Dict[str, Any] = {
            "scope": build_scope(
                scope,
                folder_ids=folder_ids,
                labels=labels,
                scenario_ids=scenario_ids,
            ),
            "targets": list(targets),
        }
        if repeat_count is not None:
            config["repeatCount"] = repeat_count
        if simulator_model is not None:
            config["simulatorModel"] = simulator_model
        if judge_model is not None:
            config["judgeModel"] = judge_model
        if scenario_ids is not None:
            config["scenarioIds"] = list(scenario_ids)

        body: Dict[str, Any] = {"config": config}
        if name is not None:
            body["name"] = name
        body.update(
            build_run_inputs(
                parameters=parameters, note=note, idempotency_key=idempotency_key
            )
        )

        response = self._http().post(f"{RUN_PLANS_PATH}/run", json=body)
        raise_for_status(response, operation="run plan")
        return response.json()

    def rerun(
        self,
        run_plan_id: str,
        *,
        parameters: Optional[Dict[str, Any]] = None,
        note: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run a plan again on the configuration it already holds.

        Args:
            run_plan_id: The plan to run.
            parameters: Constants applied to every case in this run.
            note: One short line saying why this ran, up to 200 characters.
            idempotency_key: Repeat it to make a retry join the first run.

        Returns:
            Dictionary with the run result.
        """
        body = build_run_inputs(
            parameters=parameters, note=note, idempotency_key=idempotency_key
        )
        response = self._http().post(
            f"{RUN_PLANS_PATH}/{quote_path_segment(run_plan_id)}/run", json=body
        )
        raise_for_status(response, operation="rerun plan")
        return response.json()

    def list(self, *, include_archived: bool = False) -> Any:
        """Every run plan of the project.

        Args:
            include_archived: Also serve the plans someone archived. Off by
                default, so an archived plan stays out of the way.

        Returns:
            The list of run plans.
        """
        response = self._http().get(
            RUN_PLANS_PATH,
            params={"includeArchived": "true" if include_archived else "false"},
        )
        raise_for_status(response, operation="list run plans")
        return response.json()

    def get(self, run_plan_id: str) -> Dict[str, Any]:
        """One run plan, with the configuration its next run will use.

        Args:
            run_plan_id: The plan to read.

        Returns:
            Dictionary containing the run plan.
        """
        response = self._http().get(
            f"{RUN_PLANS_PATH}/{quote_path_segment(run_plan_id)}"
        )
        raise_for_status(response, operation="get run plan")
        return response.json()

    def archive(self, run_plan_id: str) -> Dict[str, Any]:
        """Archive a run plan, taking it out of the lists without deleting the
        runs that belong to it.

        Args:
            run_plan_id: The plan to archive.

        Returns:
            Dictionary with the plan id and its archived state.
        """
        response = self._http().delete(
            f"{RUN_PLANS_PATH}/{quote_path_segment(run_plan_id)}"
        )
        raise_for_status(response, operation="archive run plan")
        return response.json()
