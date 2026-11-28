from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_evaluators_body_type import PostApiEvaluatorsBodyType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_evaluators_body_config import PostApiEvaluatorsBodyConfig


T = TypeVar("T", bound="PostApiEvaluatorsBody")


@_attrs_define
class PostApiEvaluatorsBody:
    """
    Attributes:
        name (str):
        config (PostApiEvaluatorsBodyConfig): For a built-in evaluator: { evaluatorType, settings }. For a code
            evaluator: { code, inputs: [{ identifier, type }] }; outputs are the fixed passed, score, label and details. For
            a workflow evaluator: {}.
        type_ (PostApiEvaluatorsBodyType | Unset): The kind of evaluator. "evaluator" (the default) is a built-in type
            named by config.evaluatorType; "code" is a custom Python evaluator whose config carries code and inputs;
            "workflow" wraps the workflow named by workflowId. Default: PostApiEvaluatorsBodyType.EVALUATOR.
        workflow_id (str | Unset): The workflow a "workflow" evaluator wraps. Only for type "workflow".
    """

    name: str
    config: PostApiEvaluatorsBodyConfig
    type_: PostApiEvaluatorsBodyType | Unset = PostApiEvaluatorsBodyType.EVALUATOR
    workflow_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        config = self.config.to_dict()

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value

        workflow_id = self.workflow_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "config": config,
            }
        )
        if type_ is not UNSET:
            field_dict["type"] = type_
        if workflow_id is not UNSET:
            field_dict["workflowId"] = workflow_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_evaluators_body_config import PostApiEvaluatorsBodyConfig

        d = dict(src_dict)
        name = d.pop("name")

        config = PostApiEvaluatorsBodyConfig.from_dict(d.pop("config"))

        _type_ = d.pop("type", UNSET)
        type_: PostApiEvaluatorsBodyType | Unset
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = PostApiEvaluatorsBodyType(_type_)

        workflow_id = d.pop("workflowId", UNSET)

        post_api_evaluators_body = cls(
            name=name,
            config=config,
            type_=type_,
            workflow_id=workflow_id,
        )

        post_api_evaluators_body.additional_properties = d
        return post_api_evaluators_body

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
