from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_model_type_0_parameters import (
        PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataModelType0Parameters,
    )


T = TypeVar("T", bound="PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataModelType0")


@_attrs_define
class PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataModelType0:
    """
    Attributes:
        provider (None | str):
        model (str):
        parameters (PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataModelType0Parameters):
    """

    provider: None | str
    model: str
    parameters: PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataModelType0Parameters

    def to_dict(self) -> dict[str, Any]:
        provider: None | str
        provider = self.provider

        model = self.model

        parameters = self.parameters.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "provider": provider,
                "model": model,
                "parameters": parameters,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_model_type_0_parameters import (
            PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataModelType0Parameters,
        )

        d = dict(src_dict)

        def _parse_provider(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provider = _parse_provider(d.pop("provider"))

        model = d.pop("model")

        parameters = PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataModelType0Parameters.from_dict(
            d.pop("parameters")
        )

        post_api_governance_registry_ard_search_response_200_results_item_data_model_type_0 = cls(
            provider=provider,
            model=model,
            parameters=parameters,
        )

        return post_api_governance_registry_ard_search_response_200_results_item_data_model_type_0
