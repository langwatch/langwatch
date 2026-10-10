from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_v1_query_reference_response_200_examples_item_intent import (
    GetApiV1QueryReferenceResponse200ExamplesItemIntent,
)
from ..models.get_api_v1_query_reference_response_200_examples_item_language import (
    GetApiV1QueryReferenceResponse200ExamplesItemLanguage,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_v1_query_reference_response_200_examples_item_parameters_item import (
        GetApiV1QueryReferenceResponse200ExamplesItemParametersItem,
    )
    from ..models.get_api_v1_query_reference_response_200_examples_item_requires import (
        GetApiV1QueryReferenceResponse200ExamplesItemRequires,
    )


T = TypeVar("T", bound="GetApiV1QueryReferenceResponse200ExamplesItem")


@_attrs_define
class GetApiV1QueryReferenceResponse200ExamplesItem:
    """
    Attributes:
        id (str):
        title (str):
        intent (GetApiV1QueryReferenceResponse200ExamplesItemIntent):
        language (GetApiV1QueryReferenceResponse200ExamplesItemLanguage):
        tags (list[str]):
        text (str):
        parameters (list[GetApiV1QueryReferenceResponse200ExamplesItemParametersItem]):
        requires (GetApiV1QueryReferenceResponse200ExamplesItemRequires):
        available (bool):
        notes (str | Unset):
    """

    id: str
    title: str
    intent: GetApiV1QueryReferenceResponse200ExamplesItemIntent
    language: GetApiV1QueryReferenceResponse200ExamplesItemLanguage
    tags: list[str]
    text: str
    parameters: list[GetApiV1QueryReferenceResponse200ExamplesItemParametersItem]
    requires: GetApiV1QueryReferenceResponse200ExamplesItemRequires
    available: bool
    notes: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        intent = self.intent.value

        language = self.language.value

        tags = self.tags

        text = self.text

        parameters = []
        for parameters_item_data in self.parameters:
            parameters_item = parameters_item_data.to_dict()
            parameters.append(parameters_item)

        requires = self.requires.to_dict()

        available = self.available

        notes = self.notes

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "title": title,
                "intent": intent,
                "language": language,
                "tags": tags,
                "text": text,
                "parameters": parameters,
                "requires": requires,
                "available": available,
            }
        )
        if notes is not UNSET:
            field_dict["notes"] = notes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_query_reference_response_200_examples_item_parameters_item import (
            GetApiV1QueryReferenceResponse200ExamplesItemParametersItem,
        )
        from ..models.get_api_v1_query_reference_response_200_examples_item_requires import (
            GetApiV1QueryReferenceResponse200ExamplesItemRequires,
        )

        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        intent = GetApiV1QueryReferenceResponse200ExamplesItemIntent(d.pop("intent"))

        language = GetApiV1QueryReferenceResponse200ExamplesItemLanguage(d.pop("language"))

        tags = cast(list[str], d.pop("tags"))

        text = d.pop("text")

        parameters = []
        _parameters = d.pop("parameters")
        for parameters_item_data in _parameters:
            parameters_item = GetApiV1QueryReferenceResponse200ExamplesItemParametersItem.from_dict(
                parameters_item_data
            )

            parameters.append(parameters_item)

        requires = GetApiV1QueryReferenceResponse200ExamplesItemRequires.from_dict(d.pop("requires"))

        available = d.pop("available")

        notes = d.pop("notes", UNSET)

        get_api_v1_query_reference_response_200_examples_item = cls(
            id=id,
            title=title,
            intent=intent,
            language=language,
            tags=tags,
            text=text,
            parameters=parameters,
            requires=requires,
            available=available,
            notes=notes,
        )

        get_api_v1_query_reference_response_200_examples_item.additional_properties = d
        return get_api_v1_query_reference_response_200_examples_item

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
