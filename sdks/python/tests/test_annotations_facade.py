"""Unit coverage for the annotations facade: every read hands back the
annotation rows themselves rather than the ``{"data": ...}`` wrapper the REST
app serves them in, a create refuses locally when it is missing a field the
server requires, and a delete keeps the status body it actually returns.

Transport is a mounted httpx.MockTransport; no network, no generated-client
coupling beyond get_httpx_client().
"""

import json
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pytest

from langwatch.annotations import AnnotationsFacade


class FakeRestClient:
    """The one method the facade uses from the generated client."""

    def __init__(self, handler) -> None:
        self._http = httpx.Client(
            base_url="http://langwatch.test",
            transport=httpx.MockTransport(handler),
        )

    def get_httpx_client(self) -> httpx.Client:
        return self._http


def recorder(responses: Dict[Tuple[str, str], Any], status: int = 200):
    calls: List[Tuple[str, str, Optional[Any]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, request.url.path)
        body = None
        if request.content:
            body = json.loads(request.content)
        calls.append((request.method, str(request.url), body))
        payload = responses.get(key)
        assert payload is not None, f"unexpected call {key}"
        return httpx.Response(status, json=payload)

    return handler, calls


ANNOTATION = {
    "id": "annotation_1",
    "traceId": "trace_1",
    "comment": "The answer cited the wrong document.",
    "isThumbsUp": False,
}


def facade_for(responses: Dict[Tuple[str, str], Any]) -> AnnotationsFacade:
    handler, _ = recorder(responses)
    return AnnotationsFacade(FakeRestClient(handler))


class TestGivenTheServerWrapsAnnotationsInADataEnvelope:
    """Every annotation 200 body is ``{"data": ...}``; the caller asked for
    the annotations, not the envelope."""

    def test_list_returns_the_annotation_rows(self):
        facade = facade_for({("GET", "/api/annotations"): {"data": [ANNOTATION]}})

        assert facade.list() == [ANNOTATION]

    def test_list_returns_an_empty_list_when_the_project_has_none(self):
        facade = facade_for({("GET", "/api/annotations"): {"data": []}})

        assert facade.list() == []

    def test_get_returns_the_annotation(self):
        facade = facade_for(
            {("GET", "/api/annotations/annotation_1"): {"data": ANNOTATION}}
        )

        assert facade.get("annotation_1") == ANNOTATION

    def test_get_by_trace_returns_the_annotation_rows(self):
        facade = facade_for(
            {("GET", "/api/annotations/trace/trace_1"): {"data": [ANNOTATION]}}
        )

        assert facade.get_by_trace("trace_1") == [ANNOTATION]

    def test_create_returns_the_created_annotation(self):
        facade = facade_for(
            {("POST", "/api/annotations/trace/trace_1"): {"data": ANNOTATION}}
        )

        created = facade.create(
            "trace_1",
            comment="The answer cited the wrong document.",
            is_thumbs_up=False,
        )

        assert created == ANNOTATION


class TestGivenADeleteWhoseBodyCarriesNoDataKey:
    """The delete route answers ``{status, message}`` and nothing else, so
    unwrapping it would raise on a call that succeeded."""

    def test_delete_returns_the_status_body(self):
        facade = facade_for(
            {
                ("DELETE", "/api/annotations/annotation_1"): {
                    "status": "success",
                    "message": "Annotation deleted.",
                }
            }
        )

        assert facade.delete("annotation_1") == {
            "status": "success",
            "message": "Annotation deleted.",
        }


class TestGivenTheServerRequiresACommentAndAVerdict:
    """Both fields are mandatory on the create route. Sending neither costs a
    round trip to learn what the signature could have said."""

    def test_create_without_a_comment_is_refused_before_the_request(self):
        handler, calls = recorder({})
        facade = AnnotationsFacade(FakeRestClient(handler))

        with pytest.raises(ValueError, match="comment"):
            facade.create("trace_1", is_thumbs_up=True)

        assert calls == []

    def test_create_without_a_verdict_is_refused_before_the_request(self):
        handler, calls = recorder({})
        facade = AnnotationsFacade(FakeRestClient(handler))

        with pytest.raises(ValueError, match="is_thumbs_up"):
            facade.create("trace_1", comment="Looks right.")

        assert calls == []

    def test_create_sends_the_wire_names_the_route_reads(self):
        handler, calls = recorder(
            {("POST", "/api/annotations/trace/trace_1"): {"data": ANNOTATION}}
        )
        facade = AnnotationsFacade(FakeRestClient(handler))

        facade.create(
            "trace_1",
            comment="Looks right.",
            is_thumbs_up=True,
            params={"email": "reviewer@example.test"},
        )

        _, _, body = calls[0]
        assert body == {
            "comment": "Looks right.",
            "isThumbsUp": True,
            "email": "reviewer@example.test",
        }

    def test_create_accepts_the_required_fields_supplied_through_params(self):
        """The pre-fix signature had no dedicated arguments, so a caller who
        already worked around it by putting both in ``params`` keeps working."""
        handler, calls = recorder(
            {("POST", "/api/annotations/trace/trace_1"): {"data": ANNOTATION}}
        )
        facade = AnnotationsFacade(FakeRestClient(handler))

        created = facade.create(
            "trace_1", params={"comment": "Looks right.", "isThumbsUp": True}
        )

        assert created == ANNOTATION
        assert calls[0][2] == {"comment": "Looks right.", "isThumbsUp": True}
