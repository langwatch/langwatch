from collections.abc import Mapping
from typing import Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostApiPromptsResponse200DemonstrationsInlineColumnTypesItem")


@_attrs_define
class PostApiPromptsResponse200DemonstrationsInlineColumnTypesItem:
    """
    Attributes:
        name (str):
        type_ (Union[Literal['annotations'], Literal['boolean'], Literal['chat_messages'], Literal['date'],
            Literal['evaluations'], Literal['json'], Literal['list'], Literal['number'], Literal['rag_contexts'],
            Literal['spans'], Literal['string']]):
    """

    name: str
    type_: Union[
        Literal["annotations"],
        Literal["boolean"],
        Literal["chat_messages"],
        Literal["date"],
        Literal["evaluations"],
        Literal["json"],
        Literal["list"],
        Literal["number"],
        Literal["rag_contexts"],
        Literal["spans"],
        Literal["string"],
    ]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_: Union[
            Literal["annotations"],
            Literal["boolean"],
            Literal["chat_messages"],
            Literal["date"],
            Literal["evaluations"],
            Literal["json"],
            Literal["list"],
            Literal["number"],
            Literal["rag_contexts"],
            Literal["spans"],
            Literal["string"],
        ]
        type_ = self.type_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        def _parse_type_(
            data: object,
        ) -> Union[
            Literal["annotations"],
            Literal["boolean"],
            Literal["chat_messages"],
            Literal["date"],
            Literal["evaluations"],
            Literal["json"],
            Literal["list"],
            Literal["number"],
            Literal["rag_contexts"],
            Literal["spans"],
            Literal["string"],
        ]:
            type_type_0 = cast(Literal["string"], data)
            if type_type_0 != "string":
                raise ValueError(f"type_type_0 must match const 'string', got '{type_type_0}'")
            return type_type_0
            type_type_1 = cast(Literal["boolean"], data)
            if type_type_1 != "boolean":
                raise ValueError(f"type_type_1 must match const 'boolean', got '{type_type_1}'")
            return type_type_1
            type_type_2 = cast(Literal["number"], data)
            if type_type_2 != "number":
                raise ValueError(f"type_type_2 must match const 'number', got '{type_type_2}'")
            return type_type_2
            type_type_3 = cast(Literal["date"], data)
            if type_type_3 != "date":
                raise ValueError(f"type_type_3 must match const 'date', got '{type_type_3}'")
            return type_type_3
            type_type_4 = cast(Literal["list"], data)
            if type_type_4 != "list":
                raise ValueError(f"type_type_4 must match const 'list', got '{type_type_4}'")
            return type_type_4
            type_type_5 = cast(Literal["json"], data)
            if type_type_5 != "json":
                raise ValueError(f"type_type_5 must match const 'json', got '{type_type_5}'")
            return type_type_5
            type_type_6 = cast(Literal["spans"], data)
            if type_type_6 != "spans":
                raise ValueError(f"type_type_6 must match const 'spans', got '{type_type_6}'")
            return type_type_6
            type_type_7 = cast(Literal["rag_contexts"], data)
            if type_type_7 != "rag_contexts":
                raise ValueError(f"type_type_7 must match const 'rag_contexts', got '{type_type_7}'")
            return type_type_7
            type_type_8 = cast(Literal["chat_messages"], data)
            if type_type_8 != "chat_messages":
                raise ValueError(f"type_type_8 must match const 'chat_messages', got '{type_type_8}'")
            return type_type_8
            type_type_9 = cast(Literal["annotations"], data)
            if type_type_9 != "annotations":
                raise ValueError(f"type_type_9 must match const 'annotations', got '{type_type_9}'")
            return type_type_9
            type_type_10 = cast(Literal["evaluations"], data)
            if type_type_10 != "evaluations":
                raise ValueError(f"type_type_10 must match const 'evaluations', got '{type_type_10}'")
            return type_type_10

        type_ = _parse_type_(d.pop("type"))

        post_api_prompts_response_200_demonstrations_inline_column_types_item = cls(
            name=name,
            type_=type_,
        )

        post_api_prompts_response_200_demonstrations_inline_column_types_item.additional_properties = d
        return post_api_prompts_response_200_demonstrations_inline_column_types_item

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
