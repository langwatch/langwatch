"""
End-to-end cell: a Scenario voice run through the LangWatch AI Gateway.

What this proves: a deterministic two-turn voice scenario drives real
text-to-speech (the scripted user turns) and speech-to-text (the agent-turn
transcription) entirely through the gateway's ``/v1/audio/speech`` and
``/v1/audio/transcriptions`` routes — never against ``api.openai.com`` — and
the gateway answers each call with its own response headers. The agent under
test simply echoes the user's audio back. The judge needs no LLM — its grading
is deterministic string matching — but the transcript it grades is real STT
output of the real TTS audio, produced by the STT model.

Required environment:
    SCENARIO_VOICE_GATEWAY_VK   (required) a LangWatch virtual key. When absent
                                the module skips at collection time — it runs
                                only from the scenario-voice-gateway-cell
                                workflow, which spends real provider money on a
                                provisioned key.
    SCENARIO_VOICE_GATEWAY_URL  (optional) gateway base URL; defaults to
                                https://gateway.langwatch.ai/v1

Run locally:
    SCENARIO_VOICE_GATEWAY_VK=<vk> \
        uv run pytest -s -vv -m e2e \
        tests/e2e/test_scenario_voice_gateway_e2e.py

The OpenAI Realtime websocket path is a deliberate exception and is out of
scope here — this cell exercises only the REST audio routes.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import List, Optional
from urllib.parse import urlsplit

import httpx
import pytest

# Skip at import time, not inside the test: the SDK unit job collects this
# tree with `-m "not e2e"`, and a module-level `import scenario` would still
# run during that collection (it drags in joblib and numpy). Without the key
# nothing below is needed, so the module never imports scenario at all.
SKIP_REASON = (
    "SCENARIO_VOICE_GATEWAY_VK not set; the Scenario voice gateway cell "
    "runs only from the scenario-voice-gateway-cell workflow "
    "(workflow_dispatch) with a provisioned LangWatch virtual key"
)
if not os.environ.get("SCENARIO_VOICE_GATEWAY_VK"):
    pytest.skip(SKIP_REASON, allow_module_level=True)

import scenario
from scenario.types import ScenarioResult
from scenario.voice import AdapterCapabilities, AudioChunk, VoiceAgentAdapter
from scenario.voice.tts import clear_cache

pytestmark = pytest.mark.e2e

DEFAULT_GATEWAY_URL = "https://gateway.langwatch.ai/v1"

# Two scripted user lines with distinctive words. The echo agent replays the
# audio, so each line's stems must resurface in the matching agent transcript.
LINE_1 = "The quick brown fox jumps over the lazy dog"
LINE_2 = "Purple elephants juggle seventeen oranges"
LINE_1_STEMS = ("quick", "brown", "fox", "lazy", "dog")
LINE_2_STEMS = ("purple", "elephant", "juggle", "orange")

SPEECH_ROUTE = "/audio/speech"
TRANSCRIPTION_ROUTE = "/audio/transcriptions"


class GatewayEchoAgent(VoiceAgentAdapter):
    """Agent under test that echoes the user's audio back with no transcript.

    Returning the audio without a transcript is what forces the base class to
    run STT through the gateway — the whole point of the cell. A single-slot
    buffer holds the last sent chunk; ``recv_audio`` hands it back once and then
    signals tail silence with ``TimeoutError``, the base class's normal
    end-of-turn cue.
    """

    capabilities = AdapterCapabilities()
    response_tail_silence = 0.1

    def __init__(self) -> None:
        super().__init__()
        self._pending: Optional[bytes] = None

    async def connect(self) -> None:
        self._pending = None

    async def disconnect(self) -> None:
        self._pending = None

    async def send_audio(self, chunk: AudioChunk) -> None:
        self._pending = chunk.data

    async def recv_audio(self, timeout: float) -> AudioChunk:
        if self._pending is None:
            # Nothing queued: the base drain reads this as tail silence and ends
            # the agent turn — do NOT return an empty chunk (that path means a
            # terminal chunk, not silence).
            raise asyncio.TimeoutError
        data, self._pending = self._pending, None
        return AudioChunk(data=data)


@dataclass
class RecordedRequest:
    """One HTTP request/response observed at the httpx transport seam."""

    method: str
    host: str
    path: str
    content_length: Optional[int]
    status: Optional[int] = None
    gateway_version: Optional[str] = None
    trace_id: Optional[str] = None
    provider: Optional[str] = None
    error: Optional[str] = None
    body: Optional[str] = None

    def is_audio(self) -> bool:
        return self.path.endswith(SPEECH_ROUTE) or self.path.endswith(
            TRANSCRIPTION_ROUTE
        )


@dataclass
class RequestRecorder:
    """Patches ``httpx.AsyncClient.send`` to log every request the run makes.

    The class-attribute patch is deliberate: ``scenario.run`` executes on a
    separate thread with its own event loop, so an instance-level or
    contextvar hook set on the caller's loop would never see those requests.
    """

    requests: List[RecordedRequest] = field(default_factory=list)

    def __enter__(self) -> "RequestRecorder":
        self._original = httpx.AsyncClient.send
        recorder = self

        async def send(client, request, *args, **kwargs):  # type: ignore[no-untyped-def]
            record = RecordedRequest(
                method=request.method,
                host=request.url.host,
                path=request.url.path,
                content_length=_request_length(request),
            )
            recorder.requests.append(record)
            try:
                response = await recorder._original(client, request, *args, **kwargs)
            except Exception as exc:
                record.error = type(exc).__name__
                raise
            record.status = response.status_code
            record.gateway_version = response.headers.get("X-LangWatch-Gateway-Version")
            record.trace_id = response.headers.get("X-LangWatch-Trace-Id")
            record.provider = response.headers.get("X-LangWatch-Provider")
            if response.status_code >= 300:
                try:
                    # Safe: httpx caches the body, so the OpenAI client still
                    # reads the same bytes. Catch specific transport and decode
                    # errors, never raising — logging must never break the real call.
                    body_bytes = await response.aread()
                    body_text = body_bytes.decode("utf-8", errors="replace")
                    body_collapsed = " ".join(body_text.split())
                    record.body = body_collapsed[:300]
                except (httpx.HTTPError, UnicodeDecodeError, RuntimeError) as exc:
                    record.body = f"<body unreadable: {type(exc).__name__}: {exc}>"
            return response

        httpx.AsyncClient.send = send  # type: ignore[assignment,method-assign]
        return self

    def __exit__(self, *exc_info: object) -> None:
        httpx.AsyncClient.send = self._original  # type: ignore[method-assign]

    def audio_requests(self) -> List[RecordedRequest]:
        return [r for r in self.requests if r.is_audio()]

    def format(self) -> str:
        lines: List[str] = []
        for r in self.requests:
            status = f"{r.status}" if r.status is not None else f"ERR:{r.error}"
            line = (
                f"{r.method} {r.host} {r.path} -> {status} "
                f"gateway={r.gateway_version} trace={r.trace_id} "
                f"provider={r.provider} bytes={r.content_length}"
            )
            if r.body is not None:
                line += f" body={r.body!r}"
            lines.append(line)
        return "\n".join(lines) if lines else "(no requests recorded)"


def _request_length(request: httpx.Request) -> Optional[int]:
    raw = request.headers.get("content-length")
    if raw is not None:
        return int(raw)
    # httpx.Request.content is a property that raises RequestNotRead when the
    # body is not buffered; this runs before the real send, so never let it
    # abort a live request — an unknown length is fine.
    try:
        content = request.content
    except (AttributeError, httpx.RequestNotRead):
        return None
    return len(content) if content is not None else None


async def mechanical_judge(state: scenario.ScenarioState) -> ScenarioResult:
    """Grade the recording with deterministic, LLM-free string matching.

    No LLM is involved in the grading itself. Criterion 4 nonetheless grades
    real STT output of the real TTS audio, so its stem lists tolerate the
    plural/inflection drift a transcription model introduces.

    Returning a ScenarioResult from a script step ends the run with that
    verdict — see ``ScenarioExecutor.run`` (the ``isinstance(result,
    ScenarioResult)`` branch that returns it after attaching voice output).
    """
    recording = getattr(state._executor, "_voice_recording", None)
    segments = list(getattr(recording, "segments", []) or [])
    user_segs = [s for s in segments if s.speaker == "user"]
    agent_segs = [s for s in segments if s.speaker == "agent"]

    failures: List[str] = []

    # 1. turn count
    if len(user_segs) < 2 or len(agent_segs) < 2:
        failures.append(
            f"criterion 1 (turn count): expected >=2 user and >=2 agent "
            f"segments, got {len(user_segs)} user / {len(agent_segs)} agent"
        )

    # 2. every segment carries non-empty audio
    for seg in segments:
        if not seg.audio:
            failures.append(
                f"criterion 2 (audio present): a {seg.speaker} segment has no audio"
            )
            break

    # 3. every agent segment carries a non-empty transcript (the STT output)
    for idx, seg in enumerate(agent_segs):
        if not (seg.transcript or "").strip():
            failures.append(
                f"criterion 3 (agent transcript): agent segment {idx} has no transcript"
            )

    # 4. the distinctive stems of each scripted line surface in the matching
    #    agent transcript (the echo transcribed back through STT).
    for idx, stems in enumerate((LINE_1_STEMS, LINE_2_STEMS)):
        if idx >= len(agent_segs):
            continue
        transcript = (agent_segs[idx].transcript or "").lower()
        missing = [w for w in stems if w not in transcript]
        if missing:
            failures.append(
                f"criterion 4 (spoken words): agent transcript {idx} "
                f"{transcript!r} is missing {missing}"
            )

    if failures:
        return await state._executor.fail("; ".join(failures))
    return await state._executor.succeed(
        "All mechanical criteria passed: two turns each side, audio present, "
        "agent transcripts carry the spoken words echoed back through STT."
    )


# @scenario "Scenario's voice tests run end to end through the gateway"
@pytest.mark.asyncio
async def test_scenario_voice_runs_through_the_gateway(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    virtual_key = os.environ.get("SCENARIO_VOICE_GATEWAY_VK")

    base_url = os.environ.get("SCENARIO_VOICE_GATEWAY_URL", DEFAULT_GATEWAY_URL)
    gateway_host = urlsplit(base_url).hostname or ""

    # Scenario's TTS/STT construct a bare AsyncOpenAI() per call, which reads
    # these at construction time — so pointing them at the gateway routes every
    # audio call through it. Clear the process-wide TTS cache so the run makes
    # real synthesis calls rather than serving cached bytes from a prior run.
    clear_cache()
    monkeypatch.setenv("OPENAI_API_KEY", virtual_key)
    monkeypatch.setenv("OPENAI_BASE_URL", base_url)
    monkeypatch.setenv("OPENAI_API_BASE", base_url)

    result: Optional[ScenarioResult] = None
    run_error: Optional[Exception] = None
    with RequestRecorder() as recorder:
        try:
            result = await scenario.run(
                name="Scenario voice through the gateway",
                description=(
                    "A two-turn voice conversation whose user turns are "
                    "synthesized and whose agent turns are transcribed, all "
                    "through the LangWatch AI Gateway."
                ),
                agents=[
                    GatewayEchoAgent(),
                    scenario.UserSimulatorAgent(
                        # model is required by the constructor but unused here:
                        # the scripted scenario.user(text) turns are TTS-only, so
                        # no chat completion is part of what this cell verifies.
                        model="openai/gpt-5-mini",
                        voice="openai/nova",
                    ),
                ],
                script=[
                    scenario.user(LINE_1),
                    scenario.agent(),
                    scenario.user(LINE_2),
                    scenario.agent(),
                    mechanical_judge,
                ],
                max_turns=6,
            )
        except Exception as exc:  # captured; re-raised after route assertions
            run_error = exc

    # Print BEFORE any assertion so a failing run always shows the wire log.
    print(f"\nresolved base_url={base_url} gateway_host={gateway_host}")
    print(recorder.format())
    if run_error is not None:
        # Surface a crash that is unrelated to routing (raised after the route
        # assertions below) so it is not misread as a routing failure.
        print(f"run raised {type(run_error).__name__}: {run_error}")

    audio = recorder.audio_requests()
    speech = [r for r in audio if r.path.endswith(SPEECH_ROUTE)]
    transcriptions = [r for r in audio if r.path.endswith(TRANSCRIPTION_ROUTE)]

    # The OpenAI SDK retries 429/5xx up to 2 times by default and each attempt
    # is its own send, so a transient failure retried to a 200 is still a pass —
    # judge each route by the LAST recorded response, not by every attempt.
    def _assert_route_ok(recorded: List[RecordedRequest], route: str) -> None:
        assert recorded, (
            f"no POST {base_url}{route} was recorded against {gateway_host}; "
            f"log:\n{recorder.format()}"
        )
        statuses = [r.status or r.error for r in recorded]
        first_bad = next((r for r in recorded if r.status != 200), None)
        last = recorded[-1]
        is_route_successful = last.status == 200 and any(r.status == 200 for r in recorded)
        assert is_route_successful, (
            f"POST {last.path} returned {statuses} from {gateway_host} "
            f"(expected 200) first error body: "
            f"{first_bad.body if first_bad is not None else None!r}"
        )

    # (a) TTS route reached the gateway and ended on a 200.
    _assert_route_ok(speech, SPEECH_ROUTE)

    # (b) STT route reached the gateway and ended on a 200.
    _assert_route_ok(transcriptions, TRANSCRIPTION_ROUTE)

    # (c) every audio call went to the gateway host and none to the provider.
    for r in audio:
        assert r.host == gateway_host, (
            f"audio request {r.method} {r.path} went to {r.host}, "
            f"not the gateway {gateway_host}"
        )
        assert r.host != "api.openai.com", (
            f"audio request {r.method} {r.path} bypassed the gateway to "
            "api.openai.com"
        )

    # (d) the gateway answered each audio call with its own version header.
    for r in audio:
        assert r.gateway_version, (
            f"audio request {r.method} {r.path} carried no "
            f"X-LangWatch-Gateway-Version header (status {r.status}); a bypass "
            "or a non-gateway host answered it"
        )

    if run_error is not None:
        raise run_error

    assert result is not None
    # (e) the run succeeded on the mechanical criteria.
    assert result.success is True, f"scenario failed: {result.reasoning}"

    # (f) run shape: at least two user and two agent audio segments.
    segments = list(getattr(result.audio, "segments", []) or [])
    user_segs = [s for s in segments if s.speaker == "user"]
    agent_segs = [s for s in segments if s.speaker == "agent"]
    assert len(user_segs) >= 2 and len(agent_segs) >= 2, (
        f"expected a >=2-turn voice run, got {len(user_segs)} user and "
        f"{len(agent_segs)} agent audio segments"
    )

    stt_seconds = sum(AudioChunk(data=s.audio).duration_seconds for s in agent_segs)
    tts_chars = len(LINE_1) + len(LINE_2)
    print(
        f"scenario-voice-gateway-cell: success={result.success} "
        f"base_url={base_url} speech_calls={len(speech)} "
        f"transcription_calls={len(transcriptions)} tts_chars={tts_chars} "
        f"stt_audio_seconds={stt_seconds:.2f}"
    )
