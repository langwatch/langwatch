from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error")


@_attrs_define
class PostApiWorkflowsByWorkflowIdByVersionIdRunResponse200Error:
    """
    Attributes:
        type_ (str):
        message (str):
        node_id (str | Unset):
        traceback (str | Unset):
    """

    type_: str
    message: str
    node_id: str | Unset = UNSET
    traceback: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        message = self.message

        node_id = self.node_id

        traceback = self.traceback

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "message": message,
            }
        )
        if node_id is not UNSET:
            field_dict["node_id"] = node_id
        if traceback is not UNSET:
            field_dict["traceback"] = traceback

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        message = d.pop("message")

        node_id = d.pop("node_id", UNSET)

        traceback = d.pop("traceback", UNSET)

        post_api_workflows_by_workflow_id_by_version_id_run_response_200_error = cls(
            type_=type_,
            message=message,
            node_id=node_id,
            traceback=traceback,
        )

        return post_api_workflows_by_workflow_id_by_version_id_run_response_200_error
