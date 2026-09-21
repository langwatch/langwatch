from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_status import (
    PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_workflows_by_workflow_id_by_version_id_run_response_200_result_type_0 import (
        PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0,
    )


T = TypeVar("T", bound="PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200")


@_attrs_define
class PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200:
    """
    Attributes:
        status (PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status): Execution state the run finished in
        result (None | PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0 | Unset): The workflow's output
            fields, named as the workflow names them
    """

    status: PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Status
    result: None | PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200ResultType0 | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        post_api_workflows_by_workflow_id_by_version_id_run_response_200 = cls(
            status=status,
            result=result,
        )

        post_api_workflows_by_workflow_id_by_version_id_run_response_200.additional_properties = d
        return post_api_workflows_by_workflow_id_by_version_id_run_response_200

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
