from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_status import (
    PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_error import (
        PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error,
    )
    from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_nodes import (
        PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Nodes,
    )
    from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_result_type_0 import (
        PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0,
    )


T = TypeVar("T", bound="PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200")


@_attrs_define
class PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200:
    """
    Attributes:
        status (PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status):
        result (None | PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0 | Unset):
        trace_id (str | Unset):
        nodes (PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Nodes | Unset):
        total_cost (float | Unset):
        duration_ms (float | Unset):
        error (PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error | Unset):
    """

    status: PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status
    result: None | PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0 | Unset = UNSET
    trace_id: str | Unset = UNSET
    nodes: PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Nodes | Unset = UNSET
    total_cost: float | Unset = UNSET
    duration_ms: float | Unset = UNSET
    error: PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_result_type_0 import (
            PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0,
        )

        status = self.status.value

        result: dict[str, Any] | None | Unset
        if isinstance(self.result, Unset):
            result = UNSET
        elif isinstance(self.result, PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0):
            result = self.result.to_dict()
        else:
            result = self.result

        trace_id = self.trace_id

        nodes: dict[str, Any] | Unset = UNSET
        if not isinstance(self.nodes, Unset):
            nodes = self.nodes.to_dict()

        total_cost = self.total_cost

        duration_ms = self.duration_ms

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )
        if result is not UNSET:
            field_dict["result"] = result
        if trace_id is not UNSET:
            field_dict["trace_id"] = trace_id
        if nodes is not UNSET:
            field_dict["nodes"] = nodes
        if total_cost is not UNSET:
            field_dict["total_cost"] = total_cost
        if duration_ms is not UNSET:
            field_dict["duration_ms"] = duration_ms
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_error import (
            PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error,
        )
        from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_nodes import (
            PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Nodes,
        )
        from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_result_type_0 import (
            PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0,
        )

        d = dict(src_dict)
        status = PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status(d.pop("status"))

        def _parse_result(
            data: object,
        ) -> None | PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                result_type_0 = PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0.from_dict(data)

                return result_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0 | Unset, data)

        result = _parse_result(d.pop("result", UNSET))

        trace_id = d.pop("trace_id", UNSET)

        _nodes = d.pop("nodes", UNSET)
        nodes: PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Nodes | Unset
        if isinstance(_nodes, Unset):
            nodes = UNSET
        else:
            nodes = PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Nodes.from_dict(_nodes)

        total_cost = d.pop("total_cost", UNSET)

        duration_ms = d.pop("duration_ms", UNSET)

        _error = d.pop("error", UNSET)
        error: PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error | Unset
        if isinstance(_error, Unset):
            error = UNSET
        else:
            error = PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error.from_dict(_error)

        post_api_workflows_by_workflow_id_by_version_id_run_response_200 = cls(
            status=status,
            result=result,
            trace_id=trace_id,
            nodes=nodes,
            total_cost=total_cost,
            duration_ms=duration_ms,
            error=error,
        )

        return post_api_workflows_by_workflow_id_by_version_id_run_response_200
