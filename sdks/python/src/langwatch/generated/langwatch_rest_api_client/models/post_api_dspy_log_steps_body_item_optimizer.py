from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_dspy_log_steps_body_item_optimizer_parameters import (
        PostApiDspyLogStepsBodyItemOptimizerParameters,
    )


T = TypeVar("T", bound="PostApiDspyLogStepsBodyItemOptimizer")


@_attrs_define
class PostApiDspyLogStepsBodyItemOptimizer:
    """
    Attributes:
        name (str):
        parameters (PostApiDspyLogStepsBodyItemOptimizerParameters):
    """

    name: str
    parameters: PostApiDspyLogStepsBodyItemOptimizerParameters

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        parameters = self.parameters.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "parameters": parameters,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_dspy_log_steps_body_item_optimizer_parameters import (
            PostApiDspyLogStepsBodyItemOptimizerParameters,
        )

        d = dict(src_dict)
        name = d.pop("name")

        parameters = PostApiDspyLogStepsBodyItemOptimizerParameters.from_dict(d.pop("parameters"))

        post_api_dspy_log_steps_body_item_optimizer = cls(
            name=name,
            parameters=parameters,
        )

        return post_api_dspy_log_steps_body_item_optimizer
