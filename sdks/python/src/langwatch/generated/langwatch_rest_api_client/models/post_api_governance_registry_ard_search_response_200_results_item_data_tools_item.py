from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_tools_item_status import (
    PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemStatus,
)

if TYPE_CHECKING:
    from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_tools_item_input_schema import (
        PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemInputSchema,
    )
    from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_tools_item_output_schema_type_0 import (
        PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0,
    )


T = TypeVar("T", bound="PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItem")


@_attrs_define
class PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItem:
    """
    Attributes:
        name (str):
        description (None | str):
        input_schema (PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemInputSchema):
        output_schema (None | PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0):
        status (PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemStatus):
        deprecated_in_version (int | None):
        deprecated_at (None | str):
    """

    name: str
    description: None | str
    input_schema: PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemInputSchema
    output_schema: None | PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0
    status: PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemStatus
    deprecated_in_version: int | None
    deprecated_at: None | str

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_tools_item_output_schema_type_0 import (
            PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0,
        )

        name = self.name

        description: None | str
        description = self.description

        input_schema = self.input_schema.to_dict()

        output_schema: dict[str, Any] | None
        if isinstance(
            self.output_schema, PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0
        ):
            output_schema = self.output_schema.to_dict()
        else:
            output_schema = self.output_schema

        status = self.status.value

        deprecated_in_version: int | None
        deprecated_in_version = self.deprecated_in_version

        deprecated_at: None | str
        deprecated_at = self.deprecated_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "description": description,
                "input_schema": input_schema,
                "output_schema": output_schema,
                "status": status,
                "deprecated_in_version": deprecated_in_version,
                "deprecated_at": deprecated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_tools_item_input_schema import (
            PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemInputSchema,
        )
        from ..models.post_api_governance_registry_ard_search_response_200_results_item_data_tools_item_output_schema_type_0 import (
            PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0,
        )

        d = dict(src_dict)
        name = d.pop("name")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        input_schema = PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemInputSchema.from_dict(
            d.pop("input_schema")
        )

        def _parse_output_schema(
            data: object,
        ) -> None | PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                output_schema_type_0 = (
                    PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0.from_dict(
                        data
                    )
                )

                return output_schema_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None | PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemOutputSchemaType0, data
            )

        output_schema = _parse_output_schema(d.pop("output_schema"))

        status = PostApiGovernanceRegistryArdSearchResponse200ResultsItemDataToolsItemStatus(d.pop("status"))

        def _parse_deprecated_in_version(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        deprecated_in_version = _parse_deprecated_in_version(d.pop("deprecated_in_version"))

        def _parse_deprecated_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        deprecated_at = _parse_deprecated_at(d.pop("deprecated_at"))

        post_api_governance_registry_ard_search_response_200_results_item_data_tools_item = cls(
            name=name,
            description=description,
            input_schema=input_schema,
            output_schema=output_schema,
            status=status,
            deprecated_in_version=deprecated_in_version,
            deprecated_at=deprecated_at,
        )

        return post_api_governance_registry_ard_search_response_200_results_item_data_tools_item
