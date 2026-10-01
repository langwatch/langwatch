import { RawSocketProtocol } from "@langwatch/api";
import type { ScenarioApi } from "@langwatch/scenario-contract";

/** Where Twilio dials back for a phone run's media, on the worker's own port. */
export const VOICE_MEDIA_PATH = "/twilio/:nonce";

export function createScenarioVoiceMediaDoor(): RawSocketProtocol<ScenarioApi> {
  return RawSocketProtocol.create<ScenarioApi>({
    path: VOICE_MEDIA_PATH,
    handle: (app, { request, socket, head, params }) =>
      app.acceptVoiceMediaUpgrade({
        nonce: params.nonce ?? "",
        url: request.url ?? "",
        method: request.method ?? "GET",
        headers: request.headers,
        head,
        socket,
      }),
  });
}
