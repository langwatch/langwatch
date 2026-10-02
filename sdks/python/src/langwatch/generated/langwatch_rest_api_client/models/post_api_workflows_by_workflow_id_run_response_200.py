from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_workflows_by_workflow_id_run_response_200_status import (
    PostApiWorkflowsByWorkflowIdRunResponse200Status,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_workflows_by_workflow_id_run_response_200_result_type_0 import (
        PostApiWorkflowsByWorkflowIdRunResponse200ResultType0,
    )


T = TypeVar("T", bound="PostApiWorkflowsByWorkflowIdRunResponse200")


@_attrs_define
class PostApiWorkflowsByWorkflowIdRunResponse200:
    """
    Attributes:
        status (PostApiWorkflowsByWorkflowIdRunResponse200Status):
        result (None | PostApiWorkflowsByWorkflowIdRunResponse200ResultType0 | Unset):
    """

    status: PostApiWorkflowsByWorkflowIdRunResponse200Status
    result: None | PostApiWorkflowsByWorkflowIdRunResponse200ResultType0 | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_workflows_by_workflow_id_run_response_200_result_type_0 import (
            PostApiWorkflowsByWorkflowIdRunResponse200ResultType0,
        )

        status = self.status.value

        result: dict[str, Any] | None | Unset
        if isinstance(self.result, Unset):
            result = UNSET
        elif isinstance(self.result, PostApiWorkflowsByWorkflowIdRunResponse200ResultType0):
            result = self.result.to_dict()
        else:
            result = self.result

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )
        if result is not UNSET:
            field_dict["result"] = result

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_workflows_by_workflow_id_run_response_200_result_type_0 import (
            PostApiWorkflowsByWorkflowIdRunResponse200ResultType0,
        )

        d = dict(src_dict)
        status = PostApiWorkflowsByWorkflowIdRunResponse200Status(d.pop("status"))

        def _parse_result(data: object) -> None | PostApiWorkflowsByWorkflowIdRunResponse200ResultType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                result_type_0 = PostApiWorkflowsByWorkflowIdRunResponse200ResultType0.from_dict(data)

                return result_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostApiWorkflowsByWorkflowIdRunResponse200ResultType0 | Unset, data)

        result = _parse_result(d.pop("result", UNSET))

        post_api_workflows_by_workflow_id_run_response_200 = cls(
            status=status,
            result=result,
        )

        return post_api_workflows_by_workflow_id_run_response_200
