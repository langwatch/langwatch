from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_triggers_by_id_body_action_params_type_2_method import (
    PatchApiTriggersByIdBodyActionParamsType2Method,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_action_params_type_2_headers import (
        PatchApiTriggersByIdBodyActionParamsType2Headers,
    )


T = TypeVar("T", bound="PatchApiTriggersByIdBodyActionParamsType2")


@_attrs_define
class PatchApiTriggersByIdBodyActionParamsType2:
    """Delivery to a customer endpoint over HTTP, with a body in any media type.

    Attributes:
        url (str): Where the request goes. https only, and not a private host.
        method (PatchApiTriggersByIdBodyActionParamsType2Method | Unset): The HTTP method. Absent means POST.
        headers (PatchApiTriggersByIdBodyActionParamsType2Headers | Unset): Static headers sent with every delivery. The
            values are credentials: they read back as the placeholder, and sending the placeholder back keeps the stored
            ones. Changing `url` means sending the values again in the same request.
        body_template (None | str | Unset): A Liquid template for the body. Absent sends the standard LangWatch envelope
            for a JSON content type, and an empty body for any other.
        content_type (str | Unset): The `Content-Type` the delivery announces, which also decides how the body is
            treated: `application/json` (and any `+json` type) is checked and re-serialised; any other media type sends the
            rendered template verbatim. Absent means `application/json`.
        signing_secret (None | str | Unset): Signs every delivery so the receiver can verify it came from LangWatch. A
            credential: it reads back as the placeholder, and sending the placeholder back keeps the stored one.
    """

    url: str
    method: PatchApiTriggersByIdBodyActionParamsType2Method | Unset = UNSET
    headers: PatchApiTriggersByIdBodyActionParamsType2Headers | Unset = UNSET
    body_template: None | str | Unset = UNSET
    content_type: str | Unset = UNSET
    signing_secret: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        method: str | Unset = UNSET
        if not isinstance(self.method, Unset):
            method = self.method.value

        headers: dict[str, Any] | Unset = UNSET
        if not isinstance(self.headers, Unset):
            headers = self.headers.to_dict()

        body_template: None | str | Unset
        if isinstance(self.body_template, Unset):
            body_template = UNSET
        else:
            body_template = self.body_template

        content_type = self.content_type

        signing_secret: None | str | Unset
        if isinstance(self.signing_secret, Unset):
            signing_secret = UNSET
        else:
            signing_secret = self.signing_secret

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "url": url,
            }
        )
        if method is not UNSET:
            field_dict["method"] = method
        if headers is not UNSET:
            field_dict["headers"] = headers
        if body_template is not UNSET:
            field_dict["bodyTemplate"] = body_template
        if content_type is not UNSET:
            field_dict["contentType"] = content_type
        if signing_secret is not UNSET:
            field_dict["signingSecret"] = signing_secret

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_triggers_by_id_body_action_params_type_2_headers import (
            PatchApiTriggersByIdBodyActionParamsType2Headers,
        )

        d = dict(src_dict)
        url = d.pop("url")

        _method = d.pop("method", UNSET)
        method: PatchApiTriggersByIdBodyActionParamsType2Method | Unset
        if isinstance(_method, Unset):
            method = UNSET
        else:
            method = PatchApiTriggersByIdBodyActionParamsType2Method(_method)

        _headers = d.pop("headers", UNSET)
        headers: PatchApiTriggersByIdBodyActionParamsType2Headers | Unset
        if isinstance(_headers, Unset):
            headers = UNSET
        else:
            headers = PatchApiTriggersByIdBodyActionParamsType2Headers.from_dict(_headers)

        def _parse_body_template(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        body_template = _parse_body_template(d.pop("bodyTemplate", UNSET))

        content_type = d.pop("contentType", UNSET)

        def _parse_signing_secret(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        signing_secret = _parse_signing_secret(d.pop("signingSecret", UNSET))

        patch_api_triggers_by_id_body_action_params_type_2 = cls(
            url=url,
            method=method,
            headers=headers,
            body_template=body_template,
            content_type=content_type,
            signing_secret=signing_secret,
        )

        patch_api_triggers_by_id_body_action_params_type_2.additional_properties = d
        return patch_api_triggers_by_id_body_action_params_type_2

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
