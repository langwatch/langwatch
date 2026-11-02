"""The request contract, through the Lambda handler and the HTTP server, with fake models."""

import json
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

import pytest
from fakes import make_gliner, make_tracer

from piidetector import lambda_handler
from piidetector.http_server import make_handler
from piidetector.service import BadRequest, Detector, configured_components


@pytest.fixture
def full():
    return Detector(["level0", "gliner", "tracer"], gliner=make_gliner(), tracer=make_tracer(), threads=2)


@pytest.fixture
def level0_only():
    return Detector(["level0"])


class TestLevelRequests:
    def test_returns_spans_per_text_in_order(self, full):
        response = full.handle({"texts": ["mail lucie.moreau@example.com", "Tomasz called"], "level": 1})
        assert response["level"] == 1
        first, second = response["results"]
        assert first["spans"][0]["label"] == "EMAIL"
        assert set(first["spans"][0]) == {"start", "end", "label", "score", "source"}
        assert second["spans"] == [{"start": 0, "end": 6, "label": "PERSON_NAME", "score": 0.95, "source": "tracer"}]

    # @scenario "A request needing a model this process did not load is refused"
    def test_level1_is_refused_where_only_level0_is_loaded(self, level0_only):
        with pytest.raises(BadRequest):
            level0_only.handle({"texts": ["x"], "level": 1})
        assert level0_only.handle({"texts": ["x"], "level": 0}) == {"level": 0, "results": [{"spans": []}]}

    @pytest.mark.parametrize(
        "request_body",
        [
            {"texts": ["x"]},
            {"texts": ["x"], "level": 2},
            {"texts": ["x"], "level": True},
            {"texts": ["x"], "level": "1"},
            {"texts": "x", "level": 0},
            {"texts": [1], "level": 0},
            {"texts": ["x"], "level": 0, "components": ["level0"]},
            ["x"],
        ],
    )
    def test_rejects_malformed_requests(self, full, request_body):
        with pytest.raises(BadRequest):
            full.handle(request_body)

    # @scenario "A text that fails reports its error class and nothing of the text"
    def test_a_failing_text_reports_only_its_error_class(self, full):
        class Boom:
            def predict(self, text):
                raise RuntimeError("cannot read " + text)

        full.tracer = Boom()
        response = full.handle({"texts": ["Ingrid Halvorsen", "ok"], "level": 1})
        assert response["results"][0] == {"error": "RuntimeError"}
        assert "Ingrid" not in json.dumps(response)


class TestComponentRequests:
    def test_returns_raw_parts_for_the_split_layout(self, full):
        response = full.handle({"texts": ["Tomasz"], "components": ["tracer"]})
        assert response["components"] == ["tracer"]
        assert response["results"][0]["parts"] == {
            "tracer": [{"start": 0, "end": 6, "label": "PERSON_NAME", "score": 0.95}]
        }

    @pytest.mark.parametrize("components", [[], ["nope"], "tracer"])
    def test_rejects_unknown_components(self, full, components):
        with pytest.raises(BadRequest):
            full.handle({"texts": ["x"], "components": components})

    def test_refuses_a_component_that_is_not_loaded(self, level0_only):
        with pytest.raises(BadRequest):
            level0_only.handle({"texts": ["x"], "components": ["gliner"]})


class TestConfiguration:
    def test_defaults_to_every_component(self, monkeypatch):
        monkeypatch.delenv("PII_COMPONENTS", raising=False)
        assert configured_components() == ["level0", "gliner", "tracer"]

    def test_rejects_an_unknown_component(self, monkeypatch):
        monkeypatch.setenv("PII_COMPONENTS", "level0,gpu")
        with pytest.raises(ValueError):
            configured_components()


class TestLambdaHandler:
    def test_handles_the_event_with_the_loaded_detector(self, full, monkeypatch):
        monkeypatch.setattr(lambda_handler, "DETECTOR", full)
        response = lambda_handler.handler({"texts": ["mail lucie.moreau@example.com"], "level": 0})
        assert response["results"][0]["spans"][0]["source"] == "level0"


@pytest.fixture
def server(level0_only):
    httpd = HTTPServer(("127.0.0.1", 0), make_handler(level0_only))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def post(url, body):
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class TestHttpServer:
    # @scenario "The HTTP entrypoint serves the same contract"
    def test_detect_returns_spans_and_rejects_bad_bodies(self, server):
        status, body = post(server + "/detect", json.dumps({"texts": ["a@example.com", "none"], "level": 0}).encode())
        assert status == 200
        assert [len(r["spans"]) for r in body["results"]] == [1, 0]
        assert post(server + "/detect", b"{not json")[0] == 400
        assert post(server + "/detect", json.dumps({"texts": ["x"], "level": 1}).encode())[0] == 400

    def test_healthz_and_unknown_paths(self, server):
        with urllib.request.urlopen(server + "/healthz", timeout=10) as response:
            assert json.loads(response.read()) == {"status": "ok", "components": ["level0"]}
        assert post(server + "/other", b"{}")[0] == 404
