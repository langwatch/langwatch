# Reference
## History
<details><summary><code>client.history.<a href="/src/api/resources/history/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetSpeechHistoryResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of your generated audio.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.history.list({
    pageSize: 1,
    startAfterHistoryItemId: "start_after_history_item_id",
    voiceId: "voice_id",
    modelId: "model_id",
    dateBeforeUnix: 1,
    dateAfterUnix: 1,
    sortDirection: "asc",
    search: "search",
    source: "TTS"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.HistoryListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `HistoryClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.history.<a href="/src/api/resources/history/client/Client.ts">get</a>(history_item_id) -> ElevenLabs.SpeechHistoryItemResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieves a history item.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.history.get("VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**history_item_id:** `string` — ID of the history item to be used. You can use the [Get generated items](/docs/api-reference/history/list) endpoint to retrieve a list of history items.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `HistoryClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.history.<a href="/src/api/resources/history/client/Client.ts">delete</a>(history_item_id) -> ElevenLabs.DeleteHistoryItemResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a history item by its ID
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.history.delete("VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**history_item_id:** `string` — ID of the history item to be used. You can use the [Get generated items](/docs/api-reference/history/list) endpoint to retrieve a list of history items.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `HistoryClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.history.<a href="/src/api/resources/history/client/Client.ts">getAudio</a>(history_item_id) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the audio of an history item.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.history.getAudio("history_item_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**history_item_id:** `string` — ID of the history item to be used. You can use the [Get generated items](/docs/api-reference/history/list) endpoint to retrieve a list of history items.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `HistoryClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.history.<a href="/src/api/resources/history/client/Client.ts">download</a>({ ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Download one or more history items. If one history item ID is provided, we will return a single audio file. If more than one history item IDs are provided, we will provide the history items packed into a .zip file.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.history.download({
    historyItemIds: ["history_item_ids", "history_item_ids"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.DownloadHistoryRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `HistoryClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## TextToSoundEffects
<details><summary><code>client.textToSoundEffects.<a href="/src/api/resources/textToSoundEffects/client/Client.ts">convert</a>({ ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Turn text into sound effects for your videos, voice-overs or video games using the most advanced sound effects models in the world.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToSoundEffects.convert({
    text: "Spacious braam suitable for high-impact movie trailer moments"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.CreateSoundEffectRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToSoundEffectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## AudioIsolation
<details><summary><code>client.audioIsolation.<a href="/src/api/resources/audioIsolation/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetAudioIsolationHistoryResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of all your audio isolation generations.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.audioIsolation.list({
    pageSize: 1,
    page: 1,
    search: "search"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.AudioIsolationListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioIsolationClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.audioIsolation.<a href="/src/api/resources/audioIsolation/client/Client.ts">delete</a>(history_item_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes a specific audio isolation history item and the associated media files.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.audioIsolation.delete("history_item_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**history_item_id:** `string` — Identifier of the audio isolation history item.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioIsolationClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Samples
<details><summary><code>client.samples.<a href="/src/api/resources/samples/client/Client.ts">delete</a>(voice_id, sample_id) -> ElevenLabs.DeleteSampleResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Removes a sample by its ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.samples.delete("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. You can use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — ID of the sample to be used. You can use the [Get voices](/docs/api-reference/voices/get) endpoint list all the available samples for a voice.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SamplesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## TextToSpeech
<details><summary><code>client.textToSpeech.<a href="/src/api/resources/textToSpeech/client/Client.ts">convert</a>(voice_id, { ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Converts text into speech using a voice of your choice and returns audio.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
    outputFormat: "mp3_44100_128",
    text: "The first move is what sets everything in motion.",
    modelId: "eleven_multilingual_v2"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. Use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodyTextToSpeechFull` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToSpeechClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToSpeech.<a href="/src/api/resources/textToSpeech/client/Client.ts">convertWithTimestamps</a>(voice_id, { ...params }) -> ElevenLabs.AudioWithTimestampsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Generate speech from text with precise character-level timing information for audio-text synchronization.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToSpeech.convertWithTimestamps("21m00Tcm4TlvDq8ikWAM", {
    enableLogging: true,
    optimizeStreamingLatency: 1,
    outputFormat: "alaw_8000",
    text: "This is a test for the API of ElevenLabs."
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodyTextToSpeechFullWithTimestamps` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToSpeechClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToSpeech.<a href="/src/api/resources/textToSpeech/client/Client.ts">stream</a>(voice_id, { ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Converts text into speech using a voice of your choice and returns audio as an audio stream.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToSpeech.stream("JBFqnCBsd6RMkjVDRZzb", {
    outputFormat: "mp3_44100_128",
    text: "The first move is what sets everything in motion.",
    modelId: "eleven_multilingual_v2"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. Use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.StreamTextToSpeechRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToSpeechClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToSpeech.<a href="/src/api/resources/textToSpeech/client/Client.ts">streamWithTimestamps</a>(voice_id, { ...params }) -> core.Stream&lt;ElevenLabs.StreamingAudioChunkWithTimestampsResponse&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Converts text into speech using a voice of your choice and returns a stream of JSONs containing audio as a base64 encoded string together with information on when which character was spoken.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
const response = await client.textToSpeech.streamWithTimestamps("JBFqnCBsd6RMkjVDRZzb", {
    outputFormat: "mp3_44100_128",
    text: "The first move is what sets everything in motion.",
    modelId: "eleven_multilingual_v2"
});
for await (const item of response) {
    console.log(item);
}

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. Use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.StreamTextToSpeechWithTimestampsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToSpeechClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## TextToDialogue
<details><summary><code>client.textToDialogue.<a href="/src/api/resources/textToDialogue/client/Client.ts">convert</a>({ ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Converts a list of text and voice ID pairs into speech (dialogue) and returns audio.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToDialogue.convert({
    inputs: [{
            text: "[giggling] Knock knock",
            voiceId: "JBFqnCBsd6RMkjVDRZzb"
        }, {
            text: "[curious] Who is there?",
            voiceId: "Aw4FAjKCGjjNkVhN1Xmq"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyTextToDialogueMultiVoiceV1TextToDialoguePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToDialogueClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToDialogue.<a href="/src/api/resources/textToDialogue/client/Client.ts">stream</a>({ ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Converts a list of text and voice ID pairs into speech (dialogue) and returns an audio stream.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToDialogue.stream({
    inputs: [{
            text: "[giggling] Knock knock",
            voiceId: "JBFqnCBsd6RMkjVDRZzb"
        }, {
            text: "[curious] Who is there?",
            voiceId: "Aw4FAjKCGjjNkVhN1Xmq"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyTextToDialogueMultiVoiceStreamingV1TextToDialogueStreamPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToDialogueClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToDialogue.<a href="/src/api/resources/textToDialogue/client/Client.ts">streamWithTimestamps</a>({ ...params }) -> core.Stream&lt;ElevenLabs.StreamingAudioChunkWithTimestampsAndVoiceSegmentsResponseModel&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Converts a list of text and voice ID pairs into speech (dialogue) and returns a stream of JSON blobs containing audio as a base64 encoded string and timestamps
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
const response = await client.textToDialogue.streamWithTimestamps({
    outputFormat: "mp3_22050_32",
    enableLogging: true,
    inputs: [{
            text: "Hello, how are you?",
            voiceId: "bYTqZQo3Jz7LQtmGTgwi"
        }, {
            text: "I'm doing well, thank you!",
            voiceId: "6lCwbsX1yVjD49QmpkTR"
        }]
});
for await (const item of response) {
    console.log(item);
}

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyTextToDialogueStreamWithTimestamps` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToDialogueClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToDialogue.<a href="/src/api/resources/textToDialogue/client/Client.ts">convertWithTimestamps</a>({ ...params }) -> ElevenLabs.AudioWithTimestampsAndVoiceSegmentsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Generate dialogue from text with precise character-level timing information for audio-text synchronization.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToDialogue.convertWithTimestamps({
    outputFormat: "alaw_8000",
    enableLogging: true,
    inputs: [{
            text: "Hello, how are you?",
            voiceId: "bYTqZQo3Jz7LQtmGTgwi"
        }, {
            text: "I'm doing well, thank you!",
            voiceId: "6lCwbsX1yVjD49QmpkTR"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyTextToDialogueFullWithTimestamps` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToDialogueClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## SpeechToSpeech
<details><summary><code>client.speechToSpeech.<a href="/src/api/resources/speechToSpeech/client/Client.ts">convert</a>(voice_id, { ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Transform audio from one voice to another. Maintain full control over emotion, timing and delivery.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
    audio: fs.createReadStream("/path/to/your/file"),
    outputFormat: "mp3_44100_128",
    modelId: "eleven_multilingual_sts_v2"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodySpeechToSpeechV1SpeechToSpeechVoiceIdPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechToSpeechClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.speechToSpeech.<a href="/src/api/resources/speechToSpeech/client/Client.ts">stream</a>(voice_id, { ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Stream audio from one voice to another. Maintain full control over emotion, timing and delivery.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechToSpeech.stream("JBFqnCBsd6RMkjVDRZzb", {
    audio: fs.createReadStream("/path/to/your/file"),
    outputFormat: "mp3_44100_128",
    modelId: "eleven_multilingual_sts_v2"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodySpeechToSpeechStreamingV1SpeechToSpeechVoiceIdStreamPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechToSpeechClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## TextToVoice
<details><summary><code>client.textToVoice.<a href="/src/api/resources/textToVoice/client/Client.ts">createPreviews</a>({ ...params }) -> ElevenLabs.VoiceDesignPreviewResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a voice from a text prompt.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToVoice.createPreviews({
    outputFormat: "mp3_22050_32",
    voiceDescription: "A sassy squeaky mouse"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.VoiceDesignRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToVoiceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToVoice.<a href="/src/api/resources/textToVoice/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.Voice</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a voice from previously generated voice preview. This endpoint should be called after you fetched a generated_voice_id using POST /v1/text-to-voice/design or POST /v1/text-to-voice/:voice_id/remix.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToVoice.create({
    voiceName: "Sassy squeaky mouse",
    voiceDescription: "A sassy squeaky mouse",
    generatedVoiceId: "37HceQefKmEi3bGovXjL"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyCreateANewVoiceFromVoicePreviewV1TextToVoicePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToVoiceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToVoice.<a href="/src/api/resources/textToVoice/client/Client.ts">design</a>({ ...params }) -> ElevenLabs.VoiceDesignPreviewResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Design a voice via a prompt. This method returns a list of voice previews. Each preview has a generated_voice_id and a sample of the voice as base64 encoded mp3 audio. To create a voice use the generated_voice_id of the preferred preview with the /v1/text-to-voice endpoint.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToVoice.design({
    outputFormat: "mp3_22050_32",
    voiceDescription: "A sassy squeaky mouse"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.VoiceDesignRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToVoiceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.textToVoice.<a href="/src/api/resources/textToVoice/client/Client.ts">remix</a>(voice_id, { ...params }) -> ElevenLabs.VoiceDesignPreviewResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Remix an existing voice via a prompt. This method returns a list of voice previews. Each preview has a generated_voice_id and a sample of the voice as base64 encoded mp3 audio. To create a voice use the generated_voice_id of the preferred preview with the /v1/text-to-voice endpoint.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToVoice.remix("21m00Tcm4TlvDq8ikWAM", {
    outputFormat: "mp3_22050_32",
    voiceDescription: "Make the voice have a higher pitch."
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.VoiceRemixRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TextToVoiceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## User
<details><summary><code>client.user.<a href="/src/api/resources/user/client/Client.ts">get</a>() -> ElevenLabs.User</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets information about the user
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.user.get();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `UserClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices
<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">getAll</a>({ ...params }) -> ElevenLabs.GetVoicesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of all available voices for a user. Stops working once the user's workspace exceeds 500 voices.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.getAll({
    showLegacy: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.VoicesGetAllRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">get</a>(voice_id, { ...params }) -> ElevenLabs.Voice</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns metadata about a specific voice.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.get("21m00Tcm4TlvDq8ikWAM", {
    withSettings: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. You can use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.VoicesGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">delete</a>(voice_id) -> ElevenLabs.DeleteVoiceResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes a voice by its ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.delete("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. You can use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">search</a>({ ...params }) -> ElevenLabs.GetVoicesV2Response</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets a list of all available voices for a user with search, filtering and pagination.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.search({
    nextPageToken: "next_page_token",
    pageSize: 1,
    search: "search",
    sort: "sort",
    sortDirection: "sort_direction",
    voiceType: "voice_type",
    category: "category",
    fineTuningState: "fine_tuning_state",
    collectionId: "collection_id",
    includeTotalCount: true,
    voiceIds: ["voice_ids"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.VoicesSearchRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">update</a>(voice_id, { ...params }) -> ElevenLabs.EditVoiceResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Edit a voice created by you.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.update("21m00Tcm4TlvDq8ikWAM", {
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodyEditVoiceV1VoicesVoiceIdEditPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">share</a>(public_user_id, voice_id, { ...params }) -> ElevenLabs.AddVoiceResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Add a shared voice to your collection of Voices
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.share("63e06b7e7cafdc46be4d2e0b3f045940231ae058d508589653d74d1265a574ca", "21m00Tcm4TlvDq8ikWAM", {
    newName: "John Smith"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**public_user_id:** `string` — Public user ID used to publicly identify ElevenLabs users.
    
</dd>
</dl>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. You can use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodyAddSharedVoiceV1VoicesAddPublicUserIdVoiceIdPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">getShared</a>({ ...params }) -> ElevenLabs.GetLibraryVoicesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieves a list of shared voices.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.getShared({
    pageSize: 1,
    category: "professional",
    gender: "gender",
    age: "age",
    accent: "accent",
    language: "language",
    locale: "locale",
    search: "search",
    useCases: ["use_cases"],
    descriptives: ["descriptives"],
    featured: true,
    minNoticePeriodDays: 1,
    includeCustomRates: true,
    includeLiveModerated: true,
    readerAppEnabled: true,
    ownerId: "owner_id",
    sort: "created_date",
    page: 1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.VoicesGetSharedRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.<a href="/src/api/resources/voices/client/Client.ts">findSimilarVoices</a>({ ...params }) -> ElevenLabs.GetLibraryVoicesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of shared voices similar to the provided audio sample. If neither similarity_threshold nor top_k is provided, we will apply default values.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.findSimilarVoices({});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyGetSimilarLibraryVoicesV1SimilarVoicesPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VoicesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Studio
<details><summary><code>client.studio.<a href="/src/api/resources/studio/client/Client.ts">createPodcast</a>({ ...params }) -> ElevenLabs.PodcastProjectResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create and auto-convert a podcast project. Currently, the LLM cost is covered by us but you will still be charged for the audio generation. In the future, you will be charged for both the LLM and audio generation costs.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.createPodcast({
    modelId: "eleven_multilingual_v2",
    mode: {
        type: "conversation",
        conversation: {
            hostVoiceId: "aw1NgEzBg83R7vgmiJt6",
            guestVoiceId: "aw1NgEzBg83R7vgmiJt7"
        }
    },
    source: {
        type: "text",
        text: "This is a test podcast."
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyCreatePodcastV1StudioPodcastsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `StudioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Music
<details><summary><code>client.music.<a href="/src/api/resources/music/client/Client.ts">compose</a>({ ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Compose a song from a prompt or a composition plan.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.music.compose();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyComposeMusicV1MusicPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MusicClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.music.<a href="/src/api/resources/music/client/Client.ts">composeDetailed</a>({ ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Compose a song from a prompt or a composition plan.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.music.composeDetailed();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyComposeMusicWithADetailedResponseV1MusicDetailedPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MusicClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.music.<a href="/src/api/resources/music/client/Client.ts">composeDetailedStream</a>({ ...params }) -> core.Stream&lt;string&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Stream a song and its detailed metadata using Server-Sent Events (SSE).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
const response = await client.music.composeDetailedStream({
    outputFormat: "auto"
});
for await (const item of response) {
    console.log(item);
}

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyStreamComposedMusicWithADetailedResponseV1MusicDetailedStreamPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MusicClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.music.<a href="/src/api/resources/music/client/Client.ts">stream</a>({ ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Stream a composed song from a prompt or a composition plan.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.music.stream();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyStreamComposedMusicV1MusicStreamPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MusicClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.music.<a href="/src/api/resources/music/client/Client.ts">upload</a>({ ...params }) -> ElevenLabs.MusicUploadResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Upload a music file to be later used for inpainting. Price for uploading is the same as the one for song generation. All uploaded content gets inspected for copyright infringement. If copyrighted content is detected, half of the request cost is still charged.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.music.upload({
    file: fs.createReadStream("/path/to/your/file")
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyUploadMusicV1MusicUploadPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MusicClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## dubbing
<details><summary><code>client.dubbing.<a href="/src/api/resources/dubbing/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.DubbingMetadataPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List the dubs you have access to.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.list({
    cursor: "cursor",
    pageSize: 1,
    dubbingStatus: "dubbing",
    dubbingStatuses: ["queued"],
    dubbingModels: ["dubbing_v1"],
    targetLanguageCodes: ["target_language_codes"],
    creationSources: ["flow_node"],
    filterByCreator: "personal",
    orderBy: "created_at",
    orderDirection: "DESCENDING"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.DubbingListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DubbingClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.<a href="/src/api/resources/dubbing/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.DoDubbingResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Dubs a provided audio or video file into given language.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.create({});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyDubAVideoOrAnAudioFileV1DubbingPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DubbingClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.<a href="/src/api/resources/dubbing/client/Client.ts">get</a>(dubbing_id) -> ElevenLabs.DubbingMetadataResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns metadata about a dubbing project, including whether it's still in progress or not
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.get("dubbing_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DubbingClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.<a href="/src/api/resources/dubbing/client/Client.ts">delete</a>(dubbing_id) -> ElevenLabs.DeleteDubbingResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes a dubbing project.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.delete("dubbing_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DubbingClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Models
<details><summary><code>client.models.<a href="/src/api/resources/models/client/Client.ts">list</a>() -> ElevenLabs.Model[]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets a list of available models.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.models.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ModelsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## AudioNative
<details><summary><code>client.audioNative.<a href="/src/api/resources/audioNative/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.AudioNativeCreateProjectResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates Audio Native enabled project, optionally starts conversion and returns project ID and embeddable HTML snippet.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.audioNative.create({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyCreatesAudioNativeEnabledProjectV1AudioNativePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioNativeClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.audioNative.<a href="/src/api/resources/audioNative/client/Client.ts">getSettings</a>(project_id) -> ElevenLabs.GetAudioNativeProjectSettingsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get player settings for the specific project.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.audioNative.getSettings("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the Studio project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioNativeClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.audioNative.<a href="/src/api/resources/audioNative/client/Client.ts">update</a>(project_id, { ...params }) -> ElevenLabs.AudioNativeEditContentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates content for the specific AudioNative Project.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.audioNative.update("21m00Tcm4TlvDq8ikWAM", {});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodyUpdateAudioNativeProjectContentV1AudioNativeProjectIdContentPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioNativeClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.audioNative.<a href="/src/api/resources/audioNative/client/Client.ts">updateContentFromUrl</a>({ ...params }) -> ElevenLabs.AudioNativeEditContentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Finds an AudioNative project matching the provided URL, extracts content from the URL, updates the project content, and queues it for conversion and auto-publishing.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.audioNative.updateContentFromUrl({
    url: "https://elevenlabs.io/blog/the_first_ai_that_can_laugh/"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyUpdateAudioNativeContentFromUrlV1AudioNativeContentPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioNativeClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Usage
<details><summary><code>client.usage.<a href="/src/api/resources/usage/client/Client.ts">get</a>({ ...params }) -> ElevenLabs.UsageCharactersResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

(Deprecated) This endpoint is deprecated. Use /v1/workspace/analytics/query/usage-by-product-over-time instead, which exposes the bucket size as `interval_seconds` (an integer in seconds) rather than `aggregation_interval`. Returns the usage metrics for the current user or the entire workspace they are part of. The response provides a time axis based on the specified aggregation interval (default: day), with usage values for each interval along that axis. Usage is broken down by the selected breakdown type. For example, breakdown type "voice" will return the usage of each voice for each interval along the time axis.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.usage.get({
    startUnix: 1,
    endUnix: 1,
    includeWorkspaceMetrics: true,
    breakdownType: "none",
    aggregationInterval: "hour",
    aggregationBucketSize: 1,
    metric: "credits"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.UsageGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `UsageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## PronunciationDictionaries
<details><summary><code>client.pronunciationDictionaries.<a href="/src/api/resources/pronunciationDictionaries/client/Client.ts">createFromFile</a>({ ...params }) -> ElevenLabs.AddPronunciationDictionaryResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new pronunciation dictionary from a lexicon .PLS file
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.createFromFile({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyAddAPronunciationDictionaryV1PronunciationDictionariesAddFromFilePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PronunciationDictionariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pronunciationDictionaries.<a href="/src/api/resources/pronunciationDictionaries/client/Client.ts">createFromRules</a>({ ...params }) -> ElevenLabs.AddPronunciationDictionaryResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new pronunciation dictionary from provided rules.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.createFromRules({
    rules: [{
            type: "alias",
            stringToReplace: "Thailand",
            caseSensitive: true,
            wordBoundaries: true,
            alias: "tie-land"
        }],
    name: "My Dictionary"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyAddAPronunciationDictionaryV1PronunciationDictionariesAddFromRulesPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PronunciationDictionariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pronunciationDictionaries.<a href="/src/api/resources/pronunciationDictionaries/client/Client.ts">get</a>(pronunciation_dictionary_id) -> ElevenLabs.GetPronunciationDictionaryWithRulesResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get metadata for a pronunciation dictionary
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.get("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**pronunciation_dictionary_id:** `string` — The id of the pronunciation dictionary
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PronunciationDictionariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pronunciationDictionaries.<a href="/src/api/resources/pronunciationDictionaries/client/Client.ts">update</a>(pronunciation_dictionary_id, { ...params }) -> ElevenLabs.GetPronunciationDictionaryMetadataResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Partially update the pronunciation dictionary without changing the version
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.update("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**pronunciation_dictionary_id:** `string` — The id of the pronunciation dictionary
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodyUpdatePronunciationDictionaryV1PronunciationDictionariesPronunciationDictionaryIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PronunciationDictionariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pronunciationDictionaries.<a href="/src/api/resources/pronunciationDictionaries/client/Client.ts">download</a>(dictionary_id, version_id) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a PLS file with a pronunciation dictionary version rules
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.download("dictionary_id", "version_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dictionary_id:** `string` — The id of the pronunciation dictionary
    
</dd>
</dl>

<dl>
<dd>

**version_id:** `string` — The id of the pronunciation dictionary version
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PronunciationDictionariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pronunciationDictionaries.<a href="/src/api/resources/pronunciationDictionaries/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetPronunciationDictionariesMetadataResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a list of the pronunciation dictionaries you have access to and their metadata
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.list({
    cursor: "cursor",
    pageSize: 1,
    sort: "creation_time_unix",
    sortDirection: "sort_direction"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.PronunciationDictionariesListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PronunciationDictionariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace
<details><summary><code>client.workspace.<a href="/src/api/resources/workspace/client/Client.ts">setThirdPartyDisablingPolicy</a>({ ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Set the workspace-wide Third-Party Disabling policy. When set, it forces, for every API key in the workspace, whether the holder of a key (potentially a third party who found it) may disable it via the self-disable endpoint or when it leaks publicly — overriding each key's own setting. Pass `true` to allow it for all keys, `false` to forbid it for all keys, or `null` to clear the override so per-key values and the plan default apply again. Workspace admins only.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.setThirdPartyDisablingPolicy();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodySetWorkspaceThirdPartyDisablingPolicyV1WorkspacesApiKeysThirdPartyDisablingPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WorkspaceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ServiceAccounts
<details><summary><code>client.serviceAccounts.<a href="/src/api/resources/serviceAccounts/client/Client.ts">list</a>() -> ElevenLabs.WorkspaceServiceAccountListResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List all service accounts in the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.serviceAccounts.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ServiceAccountsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.serviceAccounts.<a href="/src/api/resources/serviceAccounts/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.WorkspaceCreateServiceAccountResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new service account in the workspace. By default, a workspace can have up to 20 service accounts. Enterprise customers may request an increase to this limit, up to 100.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.serviceAccounts.create({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyCreateServiceAccountV1ServiceAccountsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ServiceAccountsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Webhooks
<details><summary><code>client.webhooks.<a href="/src/api/resources/webhooks/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.WorkspaceWebhookListResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List all webhooks for a workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.webhooks.list({
    includeUsages: false
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.WebhooksListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WebhooksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.webhooks.<a href="/src/api/resources/webhooks/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.WorkspaceCreateWebhookResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new webhook for the workspace with the specified authentication type.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.webhooks.create({
    settings: {
        authType: "hmac",
        name: "name",
        webhookUrl: "webhook_url"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyCreateWorkspaceWebhookV1WorkspaceWebhooksPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WebhooksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.webhooks.<a href="/src/api/resources/webhooks/client/Client.ts">delete</a>(webhook_id) -> ElevenLabs.DeleteWorkspaceWebhookResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete the specified workspace webhook
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.webhooks.delete("G007vmtq9uWYl7SUW9zGS8GZZa1K");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**webhook_id:** `string` — The unique ID for the webhook
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WebhooksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.webhooks.<a href="/src/api/resources/webhooks/client/Client.ts">update</a>(webhook_id, { ...params }) -> ElevenLabs.PatchWorkspaceWebhookResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update the specified workspace webhook
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.webhooks.update("G007vmtq9uWYl7SUW9zGS8GZZa1K", {
    isDisabled: true,
    name: "My Callback Webhook"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**webhook_id:** `string` — The unique ID for the webhook
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.BodyUpdateWorkspaceWebhookV1WorkspaceWebhooksWebhookIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WebhooksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## SpeechToText
<details><summary><code>client.speechToText.<a href="/src/api/resources/speechToText/client/Client.ts">convert</a>({ ...params }) -> ElevenLabs.SpeechToTextConvertResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Transcribe an audio or video file. If webhook is set to true, the request will be processed asynchronously and results sent to configured webhooks. When use_multi_channel is true and the provided audio has multiple channels, a 'transcripts' object with separate transcripts for each channel is returned; set multichannel_output_style='combined' to instead receive a single transcript with all channels merged and sorted by time. Otherwise, returns a single transcript. The optional webhook_metadata parameter allows you to attach custom data that will be included in webhook responses for request correlation and tracking.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechToText.convert({
    enableLogging: true,
    modelId: "scribe_v2"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodySpeechToTextV1SpeechToTextPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechToTextClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ForcedAlignment
<details><summary><code>client.forcedAlignment.<a href="/src/api/resources/forcedAlignment/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.ForcedAlignmentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Force align an audio file to text. Use this endpoint to get the timing information for each character and word in an audio file based on a provided text transcript.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.forcedAlignment.create({
    file: fs.createReadStream("/path/to/your/file"),
    text: "text"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyCreateForcedAlignmentV1ForcedAlignmentPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ForcedAlignmentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi
<details><summary><code>client.conversationalAi.<a href="/src/api/resources/conversationalAi/client/Client.ts">addToKnowledgeBase</a>({ ...params }) -> ElevenLabs.AddKnowledgeBaseResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Upload a file or webpage URL to create a knowledge base document. <br> <Note> After creating the document, update the agent's knowledge base by calling [Update agent](/docs/api-reference/agents/update). </Note>
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.addToKnowledgeBase({
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.BodyAddToKnowledgeBaseV1ConvaiKnowledgeBasePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationalAiClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.<a href="/src/api/resources/conversationalAi/client/Client.ts">ragIndexOverview</a>() -> ElevenLabs.RagIndexOverviewResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Provides total size and other information of RAG indexes used by knowledgebase documents
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.ragIndexOverview();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ConversationalAiClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.<a href="/src/api/resources/conversationalAi/client/Client.ts">getDocumentRagIndexes</a>(documentation_id) -> ElevenLabs.RagDocumentIndexesResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Provides information about all RAG indexes of the specified knowledgebase document.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.getDocumentRagIndexes("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationalAiClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.<a href="/src/api/resources/conversationalAi/client/Client.ts">deleteDocumentRagIndex</a>(documentation_id, rag_index_id) -> ElevenLabs.RagDocumentIndexResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete RAG index for the knowledgebase document.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.deleteDocumentRagIndex("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**rag_index_id:** `string` — The id of RAG index of document from the knowledge base.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationalAiClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Speech Engine
<details><summary><code>client.speechEngine.<a href="/src/api/resources/speechEngine/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.ListSpeechEnginesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a paginated list of Speech Engine resources.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechEngine.list({
    pageSize: 1,
    search: "search",
    sortDirection: "asc",
    sortBy: "name",
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.SpeechEngineListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechEngineClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.speechEngine.<a href="/src/api/resources/speechEngine/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.SpeechEngineResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new Speech Engine resource
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechEngine.create({
    speechEngine: {
        wsUrl: "ws_url"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.CreateSpeechEngineRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechEngineClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.speechEngine.<a href="/src/api/resources/speechEngine/client/Client.ts">get</a>(speech_engine_id) -> ElevenLabs.SpeechEngineResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve a Speech Engine resource
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechEngine.get("seng_3701k3ttaq12ewp8b7qv5rfyszkz");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**speech_engine_id:** `string` — The speech engine ID (accepts seng_ or agent_ prefix)
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechEngineClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.speechEngine.<a href="/src/api/resources/speechEngine/client/Client.ts">delete</a>(speech_engine_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a Speech Engine resource
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechEngine.delete("seng_3701k3ttaq12ewp8b7qv5rfyszkz");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**speech_engine_id:** `string` — The speech engine ID (accepts seng_ or agent_ prefix)
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechEngineClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.speechEngine.<a href="/src/api/resources/speechEngine/client/Client.ts">update</a>(speech_engine_id, { ...params }) -> ElevenLabs.SpeechEngineResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update a Speech Engine resource (partial update)
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechEngine.update("seng_3701k3ttaq12ewp8b7qv5rfyszkz");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**speech_engine_id:** `string` — The speech engine ID (accepts seng_ or agent_ prefix)
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.UpdateSpeechEngineRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeechEngineClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## EnvironmentVariables
<details><summary><code>client.environmentVariables.<a href="/src/api/resources/environmentVariables/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.EnvironmentVariablesListResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List all environment variables for the workspace with optional filtering
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.environmentVariables.list({
    cursor: "cursor",
    pageSize: 1,
    label: "label",
    environment: "environment",
    type: "string"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.EnvironmentVariablesListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `EnvironmentVariablesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.environmentVariables.<a href="/src/api/resources/environmentVariables/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.EnvironmentVariableResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new environment variable for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.environmentVariables.create({
    type: "string",
    label: "label",
    values: {
        "key": "value"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.EnvironmentVariablesCreateRequestBody` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `EnvironmentVariablesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.environmentVariables.<a href="/src/api/resources/environmentVariables/client/Client.ts">get</a>(env_var_id) -> ElevenLabs.EnvironmentVariableResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a specific environment variable by ID
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.environmentVariables.get("env_var_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**env_var_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `EnvironmentVariablesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.environmentVariables.<a href="/src/api/resources/environmentVariables/client/Client.ts">update</a>(env_var_id, { ...params }) -> ElevenLabs.EnvironmentVariableResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Replace an environment variable's values. Use null to remove an environment (except production).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.environmentVariables.update("env_var_id", {
    values: {}
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**env_var_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.UpdateEnvironmentVariableRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `EnvironmentVariablesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations
<details><summary><code>client.conversationalAi.conversations.<a href="/src/api/resources/conversationalAi/resources/conversations/client/Client.ts">getSignedUrl</a>({ ...params }) -> ElevenLabs.ConversationSignedUrlResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a signed url to start a conversation with an agent with an agent that requires authorization
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.getSignedUrl({
    agentId: "agent_3701k3ttaq12ewp8b7qv5rfyszkz",
    includeConversationId: true,
    branchId: "branch_id",
    environment: "environment"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ConversationsGetSignedUrlRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.<a href="/src/api/resources/conversationalAi/resources/conversations/client/Client.ts">getWebrtcToken</a>({ ...params }) -> ElevenLabs.TokenResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a WebRTC session token for real-time communication.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.getWebrtcToken({
    agentId: "agent_3701k3ttaq12ewp8b7qv5rfyszkz",
    participantName: "participant_name",
    branchId: "branch_id",
    environment: "environment"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ConversationsGetWebrtcTokenRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.<a href="/src/api/resources/conversationalAi/resources/conversations/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetConversationsPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all conversations of agents that user owns. With option to restrict to a specific agent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.list({
    cursor: "cursor",
    agentId: "agent_id",
    callSuccessful: "success",
    callStartBeforeUnix: 1,
    callStartAfterUnix: 1,
    callDurationMinSecs: 1,
    callDurationMaxSecs: 1,
    ratingMax: 1,
    ratingMin: 1,
    hasFeedbackComment: true,
    userId: "user_id",
    evaluationParams: ["evaluation_params"],
    dataCollectionParams: ["data_collection_params"],
    toolNames: ["tool_names"],
    toolNamesSuccessful: ["tool_names_successful"],
    toolNamesErrored: ["tool_names_errored"],
    mainLanguages: ["main_languages"],
    pageSize: 1,
    summaryMode: "exclude",
    search: "search",
    conversationInitiationSource: "unknown",
    textOnly: true,
    conversationProductType: "agents",
    branchId: "branch_id",
    topicIds: ["topic_ids"],
    excludeStatuses: ["initiated"],
    tagIds: ["tag_ids"],
    workflowNodeEnteredId: "workflow_node_entered_id",
    terminationReasons: ["termination_reasons"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ConversationsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.<a href="/src/api/resources/conversationalAi/resources/conversations/client/Client.ts">get</a>(conversation_id, { ...params }) -> ElevenLabs.GetConversationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get the details of a particular conversation
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.get("123");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` — The id of the conversation you're taking the action on.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ConversationsGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.<a href="/src/api/resources/conversationalAi/resources/conversations/client/Client.ts">delete</a>(conversation_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a particular conversation
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.delete("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` — The id of the conversation you're taking the action on.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.<a href="/src/api/resources/conversationalAi/resources/conversations/client/Client.ts">getSipMessages</a>(conversation_id, { ...params }) -> ElevenLabs.GetSipLogMessagesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get SIP messages associated with a conversation's phone call
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.getSipMessages("21m00Tcm4TlvDq8ikWAM", {
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` — The id of the conversation you're taking the action on.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ConversationsGetSipMessagesRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConversationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Twilio
<details><summary><code>client.conversationalAi.twilio.<a href="/src/api/resources/conversationalAi/resources/twilio/client/Client.ts">outboundCall</a>({ ...params }) -> ElevenLabs.TwilioOutboundCallResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Handle an outbound call via Twilio
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.twilio.outboundCall({
    agentId: "agent_id",
    agentPhoneNumberId: "agent_phone_number_id",
    toNumber: "to_number"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyHandleAnOutboundCallViaTwilioV1ConvaiTwilioOutboundCallPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TwilioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.twilio.<a href="/src/api/resources/conversationalAi/resources/twilio/client/Client.ts">registerCall</a>({ ...params }) -> string</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Register a Twilio call and return TwiML to connect the call
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.twilio.registerCall({
    agentId: "agent_id",
    fromNumber: "from_number",
    toNumber: "to_number"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyRegisterATwilioCallAndReturnTwiMlV1ConvaiTwilioRegisterCallPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TwilioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Exotel
<details><summary><code>client.conversationalAi.exotel.<a href="/src/api/resources/conversationalAi/resources/exotel/client/Client.ts">outboundCall</a>({ ...params }) -> ElevenLabs.ExotelOutboundCallResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Handle an outbound call via Exotel Connect API
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.exotel.outboundCall({
    agentId: "agent_id",
    agentPhoneNumberId: "agent_phone_number_id",
    toNumber: "to_number"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyHandleAnOutboundCallViaExotelV1ConvaiExotelOutboundCallPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ExotelClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Whatsapp
<details><summary><code>client.conversationalAi.whatsapp.<a href="/src/api/resources/conversationalAi/resources/whatsapp/client/Client.ts">outboundCall</a>({ ...params }) -> ElevenLabs.WhatsAppOutboundCallResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Make an outbound call via WhatsApp
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.whatsapp.outboundCall({
    whatsappPhoneNumberId: "whatsapp_phone_number_id",
    whatsappUserId: "whatsapp_user_id",
    whatsappCallPermissionRequestTemplateName: "whatsapp_call_permission_request_template_name",
    whatsappCallPermissionRequestTemplateLanguageCode: "whatsapp_call_permission_request_template_language_code",
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyMakeAnOutboundCallViaWhatsAppV1ConvaiWhatsappOutboundCallPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WhatsappClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.whatsapp.<a href="/src/api/resources/conversationalAi/resources/whatsapp/client/Client.ts">outboundMessage</a>({ ...params }) -> ElevenLabs.WhatsAppOutboundMessageResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Send an outbound message via WhatsApp
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.whatsapp.outboundMessage({
    whatsappPhoneNumberId: "whatsapp_phone_number_id",
    whatsappUserId: "whatsapp_user_id",
    templateName: "template_name",
    templateLanguageCode: "template_language_code",
    templateParams: [{
            type: "body",
            parameters: [{
                    text: "text"
                }]
        }],
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodySendAnOutboundMessageViaWhatsAppV1ConvaiWhatsappOutboundMessagePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WhatsappClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents
<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.CreateAgentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create an agent from a config object
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.create({
    enableVersioning: true,
    conversationConfig: {}
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">get</a>(agent_id, { ...params }) -> ElevenLabs.GetAgentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve config for an agent
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.get("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    versionId: "version_id",
    branchId: "branch_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.AgentsGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">delete</a>(agent_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete an agent
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.delete("agent_3701k3ttaq12ewp8b7qv5rfyszkz");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">update</a>(agent_id, { ...params }) -> ElevenLabs.GetAgentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Patches an Agent settings
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.update("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    enableVersioningIfNotEnabled: true,
    branchId: "branch_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.UpdateAgentRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetAgentsPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of your agents and their metadata.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.list({
    pageSize: 1,
    search: "search",
    archived: true,
    showOnlyOwnedAgents: true,
    createdByUserId: "created_by_user_id",
    sortDirection: "asc",
    sortBy: "name",
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.AgentsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">duplicate</a>(agent_id, { ...params }) -> ElevenLabs.CreateAgentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new agent by duplicating an existing one
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.duplicate("agent_3701k3ttaq12ewp8b7qv5rfyszkz");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyDuplicateAgentV1ConvaiAgentsAgentIdDuplicatePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">simulateConversation</a>(agent_id, { ...params }) -> ElevenLabs.AgentSimulatedChatTestResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deprecated. Use the `/v1/convai/agent-testing/create` and `/v1/convai/agents/:agent_id/run-tests` endpoints to create and run simulations. Run a conversation between the agent and a simulated user.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.simulateConversation("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    simulationSpecification: {
        simulatedUserConfig: {
            firstMessage: "Hello, how can I help you today?",
            language: "en",
            disableFirstMessageInterruptions: false
        }
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodySimulatesAConversationV1ConvaiAgentsAgentIdSimulateConversationPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">simulateConversationStream</a>(agent_id, { ...params }) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deprecated. Use the `/v1/convai/agent-testing/create` and `/v1/convai/agents/:agent_id/run-tests` endpoints to create and run simulations. Run a conversation between the agent and a simulated user and stream back the response. Response is streamed back as partial lists of messages that should be concatenated and once the conversation has complete a single final message with the conversation analysis will be sent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.simulateConversationStream("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    simulationSpecification: {
        simulatedUserConfig: {
            firstMessage: "Hello, how can I help you today?",
            language: "en",
            disableFirstMessageInterruptions: false
        }
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodySimulatesAConversationStreamV1ConvaiAgentsAgentIdSimulateConversationStreamPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.<a href="/src/api/resources/conversationalAi/resources/agents/client/Client.ts">runTests</a>(agent_id, { ...params }) -> ElevenLabs.GetTestSuiteInvocationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Run selected tests on the agent with provided configuration. If the agent configuration is provided, it will be used to override default agent configuration.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.runTests("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    tests: [{
            testId: "test_id"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.RunAgentTestsRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AgentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Tests
<details><summary><code>client.conversationalAi.tests.<a href="/src/api/resources/conversationalAi/resources/tests/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.CreateAgentTestResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new agent response test.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.create({
    type: "llm",
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.TestsCreateRequestBody` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.<a href="/src/api/resources/conversationalAi/resources/tests/client/Client.ts">move</a>({ ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Moves multiple tests or folders from one folder to another.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.move({
    entityIds: ["entity_ids"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyBulkMoveTestsToFolderV1ConvaiAgentTestingBulkMovePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.<a href="/src/api/resources/conversationalAi/resources/tests/client/Client.ts">get</a>(test_id) -> ElevenLabs.TestsGetResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets an agent response test by ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.get("TeaqRRdTcIfIu2i7BYfT");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**test_id:** `string` — The id of a chat response test. This is returned on test creation.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.<a href="/src/api/resources/conversationalAi/resources/tests/client/Client.ts">update</a>(test_id, { ...params }) -> ElevenLabs.TestsUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates an agent response test by ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.update("TeaqRRdTcIfIu2i7BYfT", {
    type: "llm",
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**test_id:** `string` — The id of a chat response test. This is returned on test creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.TestsUpdateRequestBody` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.<a href="/src/api/resources/conversationalAi/resources/tests/client/Client.ts">delete</a>(test_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes an agent response test by ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.delete("TeaqRRdTcIfIu2i7BYfT");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**test_id:** `string` — The id of a chat response test. This is returned on test creation.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.<a href="/src/api/resources/conversationalAi/resources/tests/client/Client.ts">summaries</a>({ ...params }) -> ElevenLabs.GetTestsSummariesByIdsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets multiple agent response tests by their IDs. Returns a dictionary mapping test IDs to test summaries.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.summaries({
    testIds: ["test_id_1", "test_id_2"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ListTestsByIdsRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.<a href="/src/api/resources/conversationalAi/resources/tests/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetTestsPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Lists all agent response tests with pagination support and optional search filtering.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.list({
    cursor: "cursor",
    pageSize: 1,
    search: "search",
    parentFolderId: "parent_folder_id",
    types: ["llm"],
    includeFolders: true,
    sortMode: "default",
    sharingMode: "all"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.TestsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Users
<details><summary><code>client.conversationalAi.users.<a href="/src/api/resources/conversationalAi/resources/users/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetConversationUsersPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get distinct users from conversations with pagination.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.users.list({
    agentId: "agent_id",
    branchId: "branch_id",
    callStartBeforeUnix: 1,
    callStartAfterUnix: 1,
    search: "search",
    pageSize: 1,
    sortBy: "last_contact_unix_secs",
    sortDirection: "asc",
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.UsersListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `UsersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi PhoneNumbers
<details><summary><code>client.conversationalAi.phoneNumbers.<a href="/src/api/resources/conversationalAi/resources/phoneNumbers/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.PhoneNumbersListResponseItem[]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve all Phone Numbers
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.phoneNumbers.list({
    provider: "twilio",
    agentId: "agent_id",
    branchId: "branch_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.PhoneNumbersListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PhoneNumbersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.phoneNumbers.<a href="/src/api/resources/conversationalAi/resources/phoneNumbers/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.CreatePhoneNumberResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Import Phone Number from provider configuration (Twilio, Exotel, or SIP trunk)
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.phoneNumbers.create({
    provider: "twilio",
    phoneNumber: "phone_number",
    label: "label",
    sid: "sid",
    token: "token"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.PhoneNumbersCreateRequestBody` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PhoneNumbersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.phoneNumbers.<a href="/src/api/resources/conversationalAi/resources/phoneNumbers/client/Client.ts">get</a>(phone_number_id) -> ElevenLabs.PhoneNumbersGetResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve Phone Number details by ID
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.phoneNumbers.get("TeaqRRdTcIfIu2i7BYfT");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**phone_number_id:** `string` — The phone number ID. This is returned when a phone number is imported.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PhoneNumbersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.phoneNumbers.<a href="/src/api/resources/conversationalAi/resources/phoneNumbers/client/Client.ts">delete</a>(phone_number_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete Phone Number by ID
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.phoneNumbers.delete("TeaqRRdTcIfIu2i7BYfT");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**phone_number_id:** `string` — The phone number ID. This is returned when a phone number is imported.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PhoneNumbersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.phoneNumbers.<a href="/src/api/resources/conversationalAi/resources/phoneNumbers/client/Client.ts">update</a>(phone_number_id, { ...params }) -> ElevenLabs.PhoneNumbersUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update assigned agent of a phone number
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.phoneNumbers.update("TeaqRRdTcIfIu2i7BYfT");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**phone_number_id:** `string` — The phone number ID. This is returned when a phone number is imported.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.UpdatePhoneNumberRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PhoneNumbersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.phoneNumbers.<a href="/src/api/resources/conversationalAi/resources/phoneNumbers/client/Client.ts">getSipMessages</a>(phone_number_id, { ...params }) -> ElevenLabs.GetSipLogMessagesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get SIP messages for a phone number
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.phoneNumbers.getSipMessages("TeaqRRdTcIfIu2i7BYfT", {
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**phone_number_id:** `string` — The phone number ID. This is returned when a phone number is imported.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.PhoneNumbersGetSipMessagesRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PhoneNumbersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi LlmUsage
<details><summary><code>client.conversationalAi.llmUsage.<a href="/src/api/resources/conversationalAi/resources/llmUsage/client/Client.ts">calculate</a>({ ...params }) -> ElevenLabs.LlmUsageCalculatorResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of LLM models and the expected cost for using them based on the provided values.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.llmUsage.calculate({
    promptLength: 1,
    numberOfPages: 1,
    ragEnabled: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.LlmUsageCalculatorPublicRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LlmUsageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Llm
<details><summary><code>client.conversationalAi.llm.<a href="/src/api/resources/conversationalAi/resources/llm/client/Client.ts">list</a>() -> ElevenLabs.LlmListResponseModelInput</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of available LLM models that can be used with agents, including their capabilities and any deprecation status. The response is filtered based on the data residency of the deployment and any compliance requirements (e.g. HIPAA) of the workspace subscription.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.llm.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `LlmClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi KnowledgeBase
<details><summary><code>client.conversationalAi.knowledgeBase.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetKnowledgeBaseListResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a list of available knowledge base documents
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.list({
    pageSize: 1,
    search: "search",
    showOnlyOwnedDocuments: true,
    createdByUserId: "created_by_user_id",
    types: ["file"],
    parentFolderId: "parent_folder_id",
    ancestorFolderId: "ancestor_folder_id",
    foldersFirst: true,
    sortDirection: "asc",
    sortBy: "name",
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.KnowledgeBaseListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `KnowledgeBaseClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/client/Client.ts">getOrCreateRagIndexes</a>({ ...params }) -> Record&lt;string, ElevenLabs.KnowledgeBaseGetOrCreateRagIndexesResponseValue&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieves and/or creates RAG indexes for multiple knowledge base documents in a single request. Maximum 100 items per request.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.getOrCreateRagIndexes({
    items: [{
            documentId: "document_id",
            createIfMissing: true,
            model: "e5_mistral_7b_instruct"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyComputeRagIndexesInBatchV1ConvaiKnowledgeBaseRagIndexPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `KnowledgeBaseClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/client/Client.ts">search</a>({ ...params }) -> ElevenLabs.KnowledgeBaseContentSearchResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fuzzy text search over knowledge base document content
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.search({
    query: "query",
    pageSize: 1,
    types: ["file"],
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.KnowledgeBaseSearchRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `KnowledgeBaseClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Tools
<details><summary><code>client.conversationalAi.tools.<a href="/src/api/resources/conversationalAi/resources/tools/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.ToolsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all available tools in the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tools.list({
    search: "search",
    pageSize: 1,
    showOnlyOwnedDocuments: true,
    createdByUserId: "created_by_user_id",
    types: ["webhook"],
    sortDirection: "asc",
    sortBy: "name",
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ToolsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tools.<a href="/src/api/resources/conversationalAi/resources/tools/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.ToolResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Add a new tool to the available tools in the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tools.create({
    toolConfig: {
        type: "client",
        name: "name",
        description: "description",
        expectsResponse: false
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.ToolRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tools.<a href="/src/api/resources/conversationalAi/resources/tools/client/Client.ts">get</a>(tool_id, { ...params }) -> ElevenLabs.ToolResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get tool that is available in the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tools.get("tool_id", {
    environment: "environment"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tool_id:** `string` — ID of the requested tool.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ToolsGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tools.<a href="/src/api/resources/conversationalAi/resources/tools/client/Client.ts">delete</a>(tool_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete tool from the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tools.delete("tool_id", {
    force: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tool_id:** `string` — ID of the requested tool.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ToolsDeleteRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tools.<a href="/src/api/resources/conversationalAi/resources/tools/client/Client.ts">update</a>(tool_id, { ...params }) -> ElevenLabs.ToolResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update tool that is available in the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tools.update("tool_id", {
    toolConfig: {
        type: "client",
        name: "name",
        description: "description",
        expectsResponse: false
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tool_id:** `string` — ID of the requested tool.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.ToolRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tools.<a href="/src/api/resources/conversationalAi/resources/tools/client/Client.ts">getDependentAgents</a>(tool_id, { ...params }) -> ElevenLabs.GetToolDependentAgentsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a list of agents depending on this tool
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tools.getDependentAgents("tool_id", {
    cursor: "cursor",
    pageSize: 1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tool_id:** `string` — ID of the requested tool.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.ToolsGetDependentAgentsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Settings
<details><summary><code>client.conversationalAi.settings.<a href="/src/api/resources/conversationalAi/resources/settings/client/Client.ts">get</a>() -> ElevenLabs.GetConvAiSettingsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve Convai settings for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.settings.get();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SettingsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.settings.<a href="/src/api/resources/conversationalAi/resources/settings/client/Client.ts">update</a>({ ...params }) -> ElevenLabs.GetConvAiSettingsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update Convai settings for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.settings.update();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.PatchConvAiSettingsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SettingsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Secrets
<details><summary><code>client.conversationalAi.secrets.<a href="/src/api/resources/conversationalAi/resources/secrets/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetWorkspaceSecretsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all workspace secrets for the user
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.secrets.list({
    pageSize: 1,
    dependencyLimit: 1,
    search: "search",
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.SecretsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SecretsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.secrets.<a href="/src/api/resources/conversationalAi/resources/secrets/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.PostWorkspaceSecretResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new secret for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.secrets.create({
    name: "name",
    value: "value"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.PostWorkspaceSecretRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SecretsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.secrets.<a href="/src/api/resources/conversationalAi/resources/secrets/client/Client.ts">get</a>(secret_id) -> ElevenLabs.ConvAiWorkspaceStoredSecretConfig</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a workspace secret by ID
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.secrets.get("secret_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**secret_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SecretsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.secrets.<a href="/src/api/resources/conversationalAi/resources/secrets/client/Client.ts">delete</a>(secret_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a workspace secret if it's not in use
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.secrets.delete("secret_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**secret_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SecretsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.secrets.<a href="/src/api/resources/conversationalAi/resources/secrets/client/Client.ts">update</a>(secret_id, { ...params }) -> ElevenLabs.PostWorkspaceSecretResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update an existing secret for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.secrets.update("secret_id", {
    name: "name",
    value: "value"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**secret_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.PatchWorkspaceSecretRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SecretsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.secrets.<a href="/src/api/resources/conversationalAi/resources/secrets/client/Client.ts">getDependencies</a>(secret_id, resource_type, { ...params }) -> ElevenLabs.GetSecretDependenciesResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get paginated list of resources that depend on a specific secret, filtered by resource type.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.secrets.getDependencies("secret_id", "tools", {
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**secret_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**resource_type:** `ElevenLabs.SecretDependencyResourceType` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.SecretsGetDependenciesRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SecretsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi BatchCalls
<details><summary><code>client.conversationalAi.batchCalls.<a href="/src/api/resources/conversationalAi/resources/batchCalls/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.BatchCallResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Submit a batch call request to schedule calls for multiple recipients.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.batchCalls.create({
    callName: "call_name",
    agentId: "agent_id",
    recipients: [{}]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodySubmitABatchCallRequestV1ConvaiBatchCallingSubmitPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BatchCallsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.batchCalls.<a href="/src/api/resources/conversationalAi/resources/batchCalls/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.WorkspaceBatchCallsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all batch calls for the current workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.batchCalls.list({
    limit: 1,
    lastDoc: "last_doc",
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BatchCallsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BatchCallsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.batchCalls.<a href="/src/api/resources/conversationalAi/resources/batchCalls/client/Client.ts">get</a>(batch_id) -> ElevenLabs.BatchCallDetailedResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get detailed information about a batch call including all recipients.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.batchCalls.get("batch_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**batch_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BatchCallsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.batchCalls.<a href="/src/api/resources/conversationalAi/resources/batchCalls/client/Client.ts">delete</a>(batch_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Permanently delete a batch call and all recipient records. Conversations remain in history.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.batchCalls.delete("batch_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**batch_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BatchCallsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.batchCalls.<a href="/src/api/resources/conversationalAi/resources/batchCalls/client/Client.ts">cancel</a>(batch_id) -> ElevenLabs.BatchCallResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Cancel a running batch call and set all recipients to cancelled status.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.batchCalls.cancel("batch_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**batch_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BatchCallsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.batchCalls.<a href="/src/api/resources/conversationalAi/resources/batchCalls/client/Client.ts">retry</a>(batch_id) -> ElevenLabs.BatchCallResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retry a batch call, calling failed and no-response recipients again.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.batchCalls.retry("batch_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**batch_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BatchCallsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi SipTrunk
<details><summary><code>client.conversationalAi.sipTrunk.<a href="/src/api/resources/conversationalAi/resources/sipTrunk/client/Client.ts">outboundCall</a>({ ...params }) -> ElevenLabs.SipTrunkOutboundCallResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Handle an outbound call via SIP trunk
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.sipTrunk.outboundCall({
    agentId: "agent_id",
    agentPhoneNumberId: "agent_phone_number_id",
    toNumber: "to_number"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.BodyHandleAnOutboundCallViaSipTrunkV1ConvaiSipTrunkOutboundCallPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SipTrunkClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi McpServers
<details><summary><code>client.conversationalAi.mcpServers.<a href="/src/api/resources/conversationalAi/resources/mcpServers/client/Client.ts">list</a>() -> ElevenLabs.McpServersResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve all MCP server configurations available in the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.<a href="/src/api/resources/conversationalAi/resources/mcpServers/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new MCP server configuration in the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.create({
    config: {
        url: "url",
        name: "name"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.McpServerRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.<a href="/src/api/resources/conversationalAi/resources/mcpServers/client/Client.ts">get</a>(mcp_server_id) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve a specific MCP server configuration from the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.get("mcp_server_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.<a href="/src/api/resources/conversationalAi/resources/mcpServers/client/Client.ts">delete</a>(mcp_server_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a specific MCP server configuration from the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.delete("mcp_server_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.<a href="/src/api/resources/conversationalAi/resources/mcpServers/client/Client.ts">update</a>(mcp_server_id, { ...params }) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update the configuration settings for an MCP server.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.update("mcp_server_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.McpServerConfigUpdateRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `McpServersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi WhatsappAccounts
<details><summary><code>client.conversationalAi.whatsappAccounts.<a href="/src/api/resources/conversationalAi/resources/whatsappAccounts/client/Client.ts">get</a>(phone_number_id) -> ElevenLabs.GetWhatsAppAccountResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a WhatsApp account
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.whatsappAccounts.get("phone_number_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**phone_number_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WhatsappAccountsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.whatsappAccounts.<a href="/src/api/resources/conversationalAi/resources/whatsappAccounts/client/Client.ts">delete</a>(phone_number_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a WhatsApp account
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.whatsappAccounts.delete("phone_number_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**phone_number_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WhatsappAccountsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.whatsappAccounts.<a href="/src/api/resources/conversationalAi/resources/whatsappAccounts/client/Client.ts">update</a>(phone_number_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update a WhatsApp account
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.whatsappAccounts.update("phone_number_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**phone_number_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.UpdateWhatsAppAccountRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WhatsappAccountsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.whatsappAccounts.<a href="/src/api/resources/conversationalAi/resources/whatsappAccounts/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.ListWhatsAppAccountsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List all WhatsApp accounts
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.whatsappAccounts.list({
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.WhatsappAccountsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WhatsappAccountsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Summaries
<details><summary><code>client.conversationalAi.agents.summaries.<a href="/src/api/resources/conversationalAi/resources/agents/resources/summaries/client/Client.ts">get</a>({ ...params }) -> Record&lt;string, ElevenLabs.SummariesGetResponseValue&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns summaries for the specified agents.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.summaries.get({
    agentIds: ["agent_ids"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.SummariesGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SummariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Widget
<details><summary><code>client.conversationalAi.agents.widget.<a href="/src/api/resources/conversationalAi/resources/agents/resources/widget/client/Client.ts">get</a>(agent_id, { ...params }) -> ElevenLabs.GetAgentEmbedResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve the widget configuration for an agent
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.widget.get("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    conversationSignature: "conversation_signature"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.WidgetGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WidgetClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Link
<details><summary><code>client.conversationalAi.agents.link.<a href="/src/api/resources/conversationalAi/resources/agents/resources/link/client/Client.ts">get</a>(agent_id) -> ElevenLabs.GetAgentLinkResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get the current link used to share the agent with others
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.link.get("agent_3701k3ttaq12ewp8b7qv5rfyszkz");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LinkClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents KnowledgeBase
<details><summary><code>client.conversationalAi.agents.knowledgeBase.<a href="/src/api/resources/conversationalAi/resources/agents/resources/knowledgeBase/client/Client.ts">size</a>(agent_id) -> ElevenLabs.GetAgentKnowledgebaseSizeResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the number of pages in the agent's knowledge base.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.knowledgeBase.size("agent_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `KnowledgeBaseClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents LlmUsage
<details><summary><code>client.conversationalAi.agents.llmUsage.<a href="/src/api/resources/conversationalAi/resources/agents/resources/llmUsage/client/Client.ts">calculate</a>(agent_id, { ...params }) -> ElevenLabs.LlmUsageCalculatorResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Calculates expected number of LLM tokens needed for the specified agent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.llmUsage.calculate("agent_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.LlmUsageCalculatorRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LlmUsageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Branches
<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">list</a>(agent_id, { ...params }) -> ElevenLabs.ListResponseAgentBranchSummary</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of branches an agent has
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.list("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    includeArchived: true,
    limit: 1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.BranchesListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">create</a>(agent_id, { ...params }) -> ElevenLabs.CreateAgentBranchResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new branch from a given version of any branch
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.create("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    parentVersionId: "parent_version_id",
    name: "name",
    description: "description"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.BodyCreateANewBranchV1ConvaiAgentsAgentIdBranchesPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">get</a>(agent_id, branch_id) -> ElevenLabs.AgentBranchResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get information about a single agent branch
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.get("agent_3701k3ttaq12ewp8b7qv5rfyszkz", "agtbranch_0901k4aafjxxfxt93gd841r7tv5t");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**branch_id:** `string` — Unique identifier for the branch.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">update</a>(agent_id, branch_id, { ...params }) -> ElevenLabs.AgentBranchResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update agent branch properties such as archiving status and protection level
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.update("agent_3701k3ttaq12ewp8b7qv5rfyszkz", "agtbranch_0901k4aafjxxfxt93gd841r7tv5t");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**branch_id:** `string` — Unique identifier for the branch.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.BodyUpdateAgentBranchV1ConvaiAgentsAgentIdBranchesBranchIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">previewMerge</a>(agent_id, source_branch_id, { ...params }) -> ElevenLabs.MergePreviewResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the result of merging the source branch into the target branch without performing the merge. Useful for showing an accurate diff before confirming.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.previewMerge("agent_3701k3ttaq12ewp8b7qv5rfyszkz", "agtbrch_8901k4t9z5defmb8vh3e9361y7nj", {
    targetBranchId: "agtbrch_8901k4t9z5defmb8vh3e9361y7nj",
    force: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**source_branch_id:** `string` — Unique identifier for the source branch to merge from.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.BranchesPreviewMergeRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">merge</a>(agent_id, source_branch_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Merge a branch into a target branch
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.merge("agent_3701k3ttaq12ewp8b7qv5rfyszkz", "agtbrch_8901k4t9z5defmb8vh3e9361y7nj", {
    targetBranchId: "agtbrch_8901k4t9z5defmb8vh3e9361y7nj"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**source_branch_id:** `string` — Unique identifier for the source branch to merge from.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.BodyMergeABranchIntoATargetBranchV1ConvaiAgentsAgentIdBranchesSourceBranchIdMergePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">previewRebase</a>(agent_id, branch_id) -> ElevenLabs.MergePreviewResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the result of rebasing the branch onto main without performing the rebase. Useful for showing an accurate diff before confirming.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.previewRebase("agent_3701k3ttaq12ewp8b7qv5rfyszkz", "agtbrch_8901k4t9z5defmb8vh3e9361y7nj");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**branch_id:** `string` — Unique identifier for the source branch to merge from.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.branches.<a href="/src/api/resources/conversationalAi/resources/agents/resources/branches/client/Client.ts">rebase</a>(agent_id, branch_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Rebase a branch onto the latest main branch, incorporating main's changes while preserving the branch's own changes.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.branches.rebase("agent_3701k3ttaq12ewp8b7qv5rfyszkz", "agtbrch_8901k4t9z5defmb8vh3e9361y7nj");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**branch_id:** `string` — Unique identifier for the source branch to merge from.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BranchesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Versions
<details><summary><code>client.conversationalAi.agents.versions.<a href="/src/api/resources/conversationalAi/resources/agents/resources/versions/client/Client.ts">get</a>(agent_id, version_id) -> ElevenLabs.AgentVersionMetadata</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get metadata for a specific agent version
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.versions.get("agent_3701k3ttaq12ewp8b7qv5rfyszkz", "agtvrsn_0901k4aafjxxfxt93gd841r7tv5t");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**version_id:** `string` — Unique identifier for the version.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VersionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Deployments
<details><summary><code>client.conversationalAi.agents.deployments.<a href="/src/api/resources/conversationalAi/resources/agents/resources/deployments/client/Client.ts">create</a>(agent_id, { ...params }) -> ElevenLabs.AgentDeploymentResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new deployment for an agent
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.deployments.create("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    deploymentRequest: {
        requests: [{
                branchId: "agtbrch_8901k4t9z5defmb8vh3e9361y7nj",
                deploymentStrategy: {
                    type: "percentage",
                    trafficPercentage: 0.5
                }
            }]
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.BodyCreateOrUpdateDeploymentsV1ConvaiAgentsAgentIdDeploymentsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DeploymentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Drafts
<details><summary><code>client.conversationalAi.agents.drafts.<a href="/src/api/resources/conversationalAi/resources/agents/resources/drafts/client/Client.ts">create</a>(agent_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new draft for an agent
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.drafts.create("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    branchId: "agtbrch_8901k4t9z5defmb8vh3e9361y7nj",
    conversationConfig: {
        "key": "value"
    },
    platformSettings: {
        "key": "value"
    },
    workflow: {
        edges: {
            "entry_to_tool_a": {
                source: "entry_node",
                target: "tool_node_a",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            },
            "start_to_entry": {
                source: "start_node",
                target: "entry_node",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            },
            "tool_a_to_failure": {
                source: "tool_node_a",
                target: "failure_node",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            },
            "tool_a_to_tool_b": {
                source: "tool_node_a",
                target: "tool_node_b",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            },
            "tool_b_to_agent_transfer": {
                source: "tool_node_b",
                target: "success_transfer",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            },
            "tool_b_to_conversation": {
                source: "tool_node_b",
                target: "success_conversation",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            },
            "tool_b_to_end": {
                source: "tool_node_b",
                target: "success_end",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            },
            "tool_b_to_phone": {
                source: "tool_node_b",
                target: "success_phone",
                forwardCondition: {
                    type: "expression",
                    expression: {
                        type: "and_operator",
                        children: []
                    }
                }
            }
        },
        nodes: {
            "entry_node": {
                type: "end"
            },
            "failure_node": {
                type: "end"
            },
            "start_node": {
                type: "end"
            },
            "success_conversation": {
                type: "end"
            },
            "success_end": {
                type: "end"
            },
            "success_phone": {
                type: "end"
            },
            "success_transfer": {
                type: "end"
            },
            "tool_node_a": {
                type: "end"
            },
            "tool_node_b": {
                type: "end"
            }
        }
    },
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.BodyCreateAgentDraftV1ConvaiAgentsAgentIdDraftsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DraftsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.agents.drafts.<a href="/src/api/resources/conversationalAi/resources/agents/resources/drafts/client/Client.ts">delete</a>(agent_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a draft for an agent
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.drafts.delete("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    branchId: "agtbrch_8901k4t9z5defmb8vh3e9361y7nj"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — The id of an agent. This is returned on agent creation.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.DraftsDeleteRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DraftsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Agents Widget Avatar
<details><summary><code>client.conversationalAi.agents.widget.avatar.<a href="/src/api/resources/conversationalAi/resources/agents/resources/widget/resources/avatar/client/Client.ts">create</a>(agent_id, { ...params }) -> ElevenLabs.PostAgentAvatarResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Sets the avatar for an agent displayed in the widget
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.agents.widget.avatar.create("agent_3701k3ttaq12ewp8b7qv5rfyszkz", {
    avatarFile: fs.createReadStream("/path/to/your/file")
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.agents.widget.BodyPostAgentAvatarV1ConvaiAgentsAgentIdAvatarPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AvatarClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Analytics LiveCount
<details><summary><code>client.conversationalAi.analytics.liveCount.<a href="/src/api/resources/conversationalAi/resources/analytics/resources/liveCount/client/Client.ts">get</a>({ ...params }) -> ElevenLabs.GetLiveCountResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get the live count of the ongoing conversations.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.analytics.liveCount.get({
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.analytics.LiveCountGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LiveCountClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations Audio
<details><summary><code>client.conversationalAi.conversations.audio.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/audio/client/Client.ts">get</a>(conversation_id) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get the audio recording of a particular conversation
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.audio.get("conversation_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` — The id of the conversation you're taking the action on.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations Feedback
<details><summary><code>client.conversationalAi.conversations.feedback.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/feedback/client/Client.ts">create</a>(conversation_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Send the feedback for the given conversation
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.feedback.create("21m00Tcm4TlvDq8ikWAM", {
    feedback: "like"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` — The id of the conversation you're taking the action on.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.ConversationFeedbackRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `FeedbackClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations Messages
<details><summary><code>client.conversationalAi.conversations.messages.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/messages/client/Client.ts">textSearch</a>({ ...params }) -> ElevenLabs.MessagesSearchResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Search through conversation transcript messages by full-text and fuzzy search
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.messages.textSearch({
    textQuery: "refund policy",
    agentId: "agent_id",
    callSuccessful: "success",
    callStartBeforeUnix: 1,
    callStartAfterUnix: 1,
    callDurationMinSecs: 1,
    callDurationMaxSecs: 1,
    ratingMax: 1,
    ratingMin: 1,
    hasFeedbackComment: true,
    userId: "user_id",
    evaluationParams: ["evaluation_params"],
    dataCollectionParams: ["data_collection_params"],
    toolNames: ["tool_names"],
    toolNamesSuccessful: ["tool_names_successful"],
    toolNamesErrored: ["tool_names_errored"],
    mainLanguages: ["main_languages"],
    pageSize: 1,
    summaryMode: "exclude",
    conversationInitiationSource: "unknown",
    textOnly: true,
    conversationProductType: "agents",
    branchId: "branch_id",
    topicIds: ["topic_ids"],
    sortBy: "search_score",
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.MessagesTextSearchRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MessagesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.messages.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/messages/client/Client.ts">search</a>({ ...params }) -> ElevenLabs.MessagesSearchResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Search conversation transcripts by semantic similarity to surface relevant messages based on meaning and intent, rather than exact keyword matches
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.messages.search({
    textQuery: "Customer asking to cancel and get money back",
    agentId: "agent_id",
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.MessagesSearchRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MessagesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations Tags
<details><summary><code>client.conversationalAi.conversations.tags.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/tags/client/Client.ts">assign</a>(conversation_id, { ...params }) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Assign one or more conversation tags to a conversation. Tags that are already assigned are ignored. Tags must belong to the same workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.tags.assign("conversation_id", {
    tagIds: ["tag_ids"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.AssignConversationTagsRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TagsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.tags.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/tags/client/Client.ts">unassign</a>(conversation_id, tag_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Remove a single conversation tag from a conversation.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.tags.unassign("conversation_id", "tag_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**tag_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TagsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.tags.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/tags/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetConversationTagsPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List conversation tags for the workspace, ordered by most recently created first.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.tags.list({
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.TagsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TagsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.tags.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/tags/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.ConversationTagResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new conversation tag for the workspace.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.tags.create({
    title: "title"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.CreateConversationTagRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TagsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.tags.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/tags/client/Client.ts">get</a>(tag_id) -> ElevenLabs.ConversationTagResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a conversation tag by ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.tags.get("tag_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tag_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TagsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.tags.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/tags/client/Client.ts">delete</a>(tag_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a conversation tag. Restricted to the tag owner or a workspace admin.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.tags.delete("tag_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tag_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TagsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.tags.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/tags/client/Client.ts">update</a>(tag_id, { ...params }) -> ElevenLabs.ConversationTagResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update a conversation tag's title and/or description. Restricted to the tag owner or a workspace admin.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.tags.update("tag_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tag_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.PatchConversationTagRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TagsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations Files
<details><summary><code>client.conversationalAi.conversations.files.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/files/client/Client.ts">create</a>(conversation_id, { ...params }) -> ElevenLabs.ConvAiFileUploadResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Upload an image or PDF file for a conversation. Returns a unique file ID that can be used to reference the file in the conversation.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.files.create("conversation_id", {
    file: fs.createReadStream("/path/to/your/file")
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.BodyUploadFileV1ConvaiConversationsConversationIdFilesPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `FilesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.files.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/files/client/Client.ts">delete</a>(conversation_id, file_id) -> ElevenLabs.ConvAiFileUploadResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Remove a file upload from a conversation. Only possible if the file hasn't already been used in the conversation.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.files.delete("conversation_id", "file_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**file_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `FilesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations Topics
<details><summary><code>client.conversationalAi.conversations.topics.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/topics/client/Client.ts">get</a>(agent_id, { ...params }) -> ElevenLabs.GetAgentTopicsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the latest topic discovery run results for a given agent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.topics.get("agent_id", {
    fromUnixSecs: 1,
    toUnixSecs: 1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**agent_id:** `string` — ID of the agent
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.TopicsGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TopicsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Conversations Analysis
<details><summary><code>client.conversationalAi.conversations.analysis.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/analysis/client/Client.ts">run</a>(conversation_id) -> ElevenLabs.GetConversationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Run the analysis for a conversation using the agent's current evaluation criteria and data collection settings.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.analysis.run("conversation_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` — ID of the conversation
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AnalysisClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.conversations.analysis.<a href="/src/api/resources/conversationalAi/resources/conversations/resources/analysis/client/Client.ts">runEvaluation</a>(conversation_id, { ...params }) -> ElevenLabs.GetConversationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Rerun a specific evaluation for a conversation.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.conversations.analysis.runEvaluation("conversation_id", {
    evaluationId: "evaluation_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**conversation_id:** `string` — ID of the conversation
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.conversations.RunConversationEvaluationsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AnalysisClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Dashboard Settings
<details><summary><code>client.conversationalAi.dashboard.settings.<a href="/src/api/resources/conversationalAi/resources/dashboard/resources/settings/client/Client.ts">get</a>() -> ElevenLabs.GetConvAiDashboardSettingsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve Convai dashboard settings for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.dashboard.settings.get();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SettingsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.dashboard.settings.<a href="/src/api/resources/conversationalAi/resources/dashboard/resources/settings/client/Client.ts">update</a>({ ...params }) -> ElevenLabs.GetConvAiDashboardSettingsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update Convai dashboard settings for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.dashboard.settings.update();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.dashboard.PatchConvAiDashboardSettingsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SettingsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi KnowledgeBase Documents
<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">createFromUrl</a>({ ...params }) -> ElevenLabs.AddKnowledgeBaseResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a knowledge base document generated by scraping the given webpage.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.createFromUrl({
    url: "url"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyCreateUrlDocumentV1ConvaiKnowledgeBaseUrlPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">createFromFile</a>({ ...params }) -> ElevenLabs.AddKnowledgeBaseResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a knowledge base document generated form the uploaded file.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.createFromFile({
    file: fs.createReadStream("/path/to/your/file")
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyCreateFileDocumentV1ConvaiKnowledgeBaseFilePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">createFromText</a>({ ...params }) -> ElevenLabs.AddKnowledgeBaseResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a knowledge base document containing the provided text.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.createFromText({
    text: "text"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyCreateTextDocumentV1ConvaiKnowledgeBaseTextPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">createFolder</a>({ ...params }) -> ElevenLabs.AddKnowledgeBaseResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a folder used for grouping documents together.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.createFolder({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyCreateFolderV1ConvaiKnowledgeBaseFolderPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">get</a>(documentation_id, { ...params }) -> ElevenLabs.DocumentsGetResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get details about a specific documentation making up the agent's knowledge base
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.get("21m00Tcm4TlvDq8ikWAM", {
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.DocumentsGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">delete</a>(documentation_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a document or folder from the knowledge base.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.delete("21m00Tcm4TlvDq8ikWAM", {
    force: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.DocumentsDeleteRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">update</a>(documentation_id, { ...params }) -> ElevenLabs.DocumentsUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update the name and/or content of a document.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.update("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyUpdateDocumentV1ConvaiKnowledgeBaseDocumentationIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">getAgents</a>(documentation_id, { ...params }) -> ElevenLabs.GetKnowledgeBaseDependentAgentsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a list of agents depending on this knowledge base document
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.getAgents("21m00Tcm4TlvDq8ikWAM", {
    dependentType: "direct",
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.DocumentsGetAgentsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">getContent</a>(documentation_id) -> string</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get the entire content of a document from the knowledge base
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.getContent("documentation_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">getSourceFileUrl</a>(documentation_id) -> ElevenLabs.KnowledgeBaseSourceFileUrlResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get a signed URL to download the original source file of a file-type document from the knowledge base
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.getSourceFileUrl("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">move</a>(document_id, { ...params }) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Moves the entity from one folder to another.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.move("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**document_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyMoveEntityToFolderV1ConvaiKnowledgeBaseDocumentIdMovePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.documents.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/client/Client.ts">bulkMove</a>({ ...params }) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Moves multiple entities from one folder to another.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.bulkMove({
    documentIds: ["21m00Tcm4TlvDq8ikWAM", "31m00Tcm4TlvDq8ikWBM"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyBulkMoveEntitiesToFolderV1ConvaiKnowledgeBaseBulkMovePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi KnowledgeBase Document
<details><summary><code>client.conversationalAi.knowledgeBase.document.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/document/client/Client.ts">updateFile</a>(documentation_id, { ...params }) -> ElevenLabs.DocumentUpdateFileResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update the source file of a file document. The document name, content, and metadata are updated to reflect the new file. Any manual content edits will be overwritten.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.document.updateFile("21m00Tcm4TlvDq8ikWAM", {
    file: fs.createReadStream("/path/to/your/file")
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.BodyUpdateFileDocumentV1ConvaiKnowledgeBaseDocumentationIdUpdateFilePatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.document.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/document/client/Client.ts">refresh</a>(documentation_id) -> ElevenLabs.DocumentRefreshResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Manually refresh a URL document by re-fetching its content from the source URL.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.document.refresh("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.knowledgeBase.document.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/document/client/Client.ts">computeRagIndex</a>(documentation_id, { ...params }) -> ElevenLabs.RagDocumentIndexResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

In case the document is not RAG indexed, it triggers rag indexing task, otherwise it just returns the current status.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.document.computeRagIndex("21m00Tcm4TlvDq8ikWAM", {
    model: "e5_mistral_7b_instruct"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.RagIndexRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DocumentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi KnowledgeBase Documents Summaries
<details><summary><code>client.conversationalAi.knowledgeBase.documents.summaries.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/resources/summaries/client/Client.ts">get</a>({ ...params }) -> Record&lt;string, ElevenLabs.SummariesGetResponseValue&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets multiple knowledge base document summaries by their IDs.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.summaries.get({
    documentIds: ["21m00Tcm4TlvDq8ikWAM", "31n11Udm5UmwEr9jkXBN"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.documents.SummariesGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SummariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi KnowledgeBase Documents Chunk
<details><summary><code>client.conversationalAi.knowledgeBase.documents.chunk.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/resources/chunk/client/Client.ts">get</a>(documentation_id, chunk_id, { ...params }) -> ElevenLabs.KnowledgeBaseDocumentChunkResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get details about a specific documentation part used by RAG.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.chunk.get("21m00Tcm4TlvDq8ikWAM", "chunk_id", {
    embeddingModel: "e5_mistral_7b_instruct"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**chunk_id:** `string` — The id of a document RAG chunk from the knowledge base.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.documents.ChunkGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChunkClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi KnowledgeBase Documents Chunks
<details><summary><code>client.conversationalAi.knowledgeBase.documents.chunks.<a href="/src/api/resources/conversationalAi/resources/knowledgeBase/resources/documents/resources/chunks/client/Client.ts">list</a>(documentation_id, { ...params }) -> ElevenLabs.KnowledgeBaseDocumentChunksResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all RAG chunks for a specific knowledge base document.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.knowledgeBase.documents.chunks.list("21m00Tcm4TlvDq8ikWAM", {
    embeddingModel: "e5_mistral_7b_instruct",
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**documentation_id:** `string` — The id of a document from the knowledge base. This is returned on document addition.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.knowledgeBase.documents.ChunksListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChunksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi McpServers Tools
<details><summary><code>client.conversationalAi.mcpServers.tools.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/tools/client/Client.ts">list</a>(mcp_server_id, { ...params }) -> ElevenLabs.ListMcpToolsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve all tools available for a specific MCP server configuration.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.tools.list("mcp_server_id", {
    environment: "environment"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.mcpServers.ToolsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi McpServers ApprovalPolicy
<details><summary><code>client.conversationalAi.mcpServers.approvalPolicy.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/approvalPolicy/client/Client.ts">update</a>(mcp_server_id, { ...params }) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update the approval policy configuration for an MCP server. DEPRECATED: Use PATCH /mcp-servers/{id} endpoint instead.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.approvalPolicy.update("mcp_server_id", {
    approvalPolicy: "auto_approve_all"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.mcpServers.McpApprovalPolicyUpdateRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApprovalPolicyClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi McpServers ToolApprovals
<details><summary><code>client.conversationalAi.mcpServers.toolApprovals.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/toolApprovals/client/Client.ts">create</a>(mcp_server_id, { ...params }) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Add approval for a specific MCP tool when using per-tool approval mode.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.toolApprovals.create("mcp_server_id", {
    toolName: "tool_name",
    toolDescription: "tool_description"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.mcpServers.McpToolAddApprovalRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolApprovalsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.toolApprovals.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/toolApprovals/client/Client.ts">delete</a>(mcp_server_id, tool_name) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Remove approval for a specific MCP tool when using per-tool approval mode.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.toolApprovals.delete("mcp_server_id", "tool_name");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**tool_name:** `string` — Name of the MCP tool to remove approval for.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolApprovalsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi McpServers ToolConfigs
<details><summary><code>client.conversationalAi.mcpServers.toolConfigs.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/toolConfigs/client/Client.ts">create</a>(mcp_server_id, { ...params }) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create configuration overrides for a specific MCP tool.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.toolConfigs.create("mcp_server_id", {
    environment: "environment",
    toolName: "tool_name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.mcpServers.McpToolConfigOverrideCreateRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolConfigsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.toolConfigs.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/toolConfigs/client/Client.ts">get</a>(mcp_server_id, tool_name) -> ElevenLabs.McpToolConfigOverrideOutput</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve configuration overrides for a specific MCP tool.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.toolConfigs.get("mcp_server_id", "tool_name");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**tool_name:** `string` — Name of the MCP tool to retrieve config overrides for.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolConfigsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.toolConfigs.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/toolConfigs/client/Client.ts">delete</a>(mcp_server_id, tool_name) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Remove configuration overrides for a specific MCP tool.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.toolConfigs.delete("mcp_server_id", "tool_name");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**tool_name:** `string` — Name of the MCP tool to remove config overrides for.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolConfigsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.mcpServers.toolConfigs.<a href="/src/api/resources/conversationalAi/resources/mcpServers/resources/toolConfigs/client/Client.ts">update</a>(mcp_server_id, tool_name, { ...params }) -> ElevenLabs.McpServerResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update configuration overrides for a specific MCP tool.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.mcpServers.toolConfigs.update("mcp_server_id", "tool_name", {
    environment: "environment"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**mcp_server_id:** `string` — ID of the MCP Server.
    
</dd>
</dl>

<dl>
<dd>

**tool_name:** `string` — Name of the MCP tool to update config overrides for.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.mcpServers.McpToolConfigOverrideUpdateRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ToolConfigsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Tests Folders
<details><summary><code>client.conversationalAi.tests.folders.<a href="/src/api/resources/conversationalAi/resources/tests/resources/folders/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.CreateAgentTestFolderResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a folder for organizing agent tests.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.folders.create({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.tests.BodyCreateAgentTestFolderV1ConvaiAgentTestingFoldersPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `FoldersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.folders.<a href="/src/api/resources/conversationalAi/resources/tests/resources/folders/client/Client.ts">get</a>(folder_id) -> ElevenLabs.GetAgentTestFolderResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets an agent test folder by ID, including its folder path.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.folders.get("tfld_7301khxdkycse5f88fzjdtrterzm");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**folder_id:** `string` — The folder ID.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `FoldersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.folders.<a href="/src/api/resources/conversationalAi/resources/tests/resources/folders/client/Client.ts">delete</a>(folder_id, { ...params }) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes an agent test folder by ID. Use force=true to delete a non-empty folder and all its contents.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.folders.delete("tfld_7301khxdkycse5f88fzjdtrterzm", {
    force: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**folder_id:** `string` — The folder ID.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.tests.FoldersDeleteRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `FoldersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.folders.<a href="/src/api/resources/conversationalAi/resources/tests/resources/folders/client/Client.ts">update</a>(folder_id, { ...params }) -> ElevenLabs.GetAgentTestFolderResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates an agent test folder. Currently only supports updating the folder name.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.folders.update("tfld_7301khxdkycse5f88fzjdtrterzm", {
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**folder_id:** `string` — The folder ID.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.tests.BodyUpdateAgentTestFolderV1ConvaiAgentTestingFoldersFolderIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `FoldersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Tests Invocations
<details><summary><code>client.conversationalAi.tests.invocations.<a href="/src/api/resources/conversationalAi/resources/tests/resources/invocations/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.GetTestInvocationsPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Lists all test invocations with pagination support and optional search filtering.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.invocations.list({
    agentId: "agent_id",
    pageSize: 1,
    cursor: "cursor"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.tests.InvocationsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `InvocationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.invocations.<a href="/src/api/resources/conversationalAi/resources/tests/resources/invocations/client/Client.ts">get</a>(test_invocation_id) -> ElevenLabs.GetTestSuiteInvocationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets a test invocation by ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.invocations.get("test_invocation_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**test_invocation_id:** `string` — The id of a test invocation. This is returned when tests are run.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `InvocationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.conversationalAi.tests.invocations.<a href="/src/api/resources/conversationalAi/resources/tests/resources/invocations/client/Client.ts">resubmit</a>(test_invocation_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Resubmits specific test runs from a test invocation.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tests.invocations.resubmit("test_invocation_id", {
    testRunIds: ["test_run_ids"],
    agentId: "agent_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**test_invocation_id:** `string` — The id of a test invocation. This is returned when tests are run.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.tests.ResubmitTestsRequestModel` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `InvocationsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ConversationalAi Tools Executions
<details><summary><code>client.conversationalAi.tools.executions.<a href="/src/api/resources/conversationalAi/resources/tools/resources/executions/client/Client.ts">get</a>(tool_id, { ...params }) -> ElevenLabs.GetToolExecutionsPageResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get paginated list of tool executions for a specific tool.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.conversationalAi.tools.executions.get("tool_id", {
    cursor: "cursor",
    pageSize: 1,
    isError: true,
    agentId: "agent_id",
    branchId: "branch_id",
    startTime: 1.1,
    endTime: 1.1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**tool_id:** `string` — ID of the requested tool.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.conversationalAi.tools.ExecutionsGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ExecutionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Project
<details><summary><code>client.dubbing.project.<a href="/src/api/resources/dubbing/resources/project/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.DubbingProjectListResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List the workspace's dubbing projects (cursor-paginated).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.list({
    pageSize: 20
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.ProjectListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.<a href="/src/api/resources/dubbing/resources/project/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.DubbingProjectResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a dubbing project from an uploaded file or a source URL.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.create({
    sourceUrl: "https://example.com/promo.mp4",
    sourceLanguage: "en",
    reference: "Q3 marketing video"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.BodyCreateDubbingProjectV1DubbingProjectPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.<a href="/src/api/resources/dubbing/resources/project/client/Client.ts">get</a>(project_id) -> ElevenLabs.DubbingProjectResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Full project detail, including its language target ids.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.get("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project to fetch.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.<a href="/src/api/resources/dubbing/resources/project/client/Client.ts">delete</a>(project_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a project and its language targets.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.delete("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project to delete.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Resource
<details><summary><code>client.dubbing.resource.<a href="/src/api/resources/dubbing/resources/resource/client/Client.ts">get</a>(dubbing_id) -> ElevenLabs.DubbingResource</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Given a dubbing ID generated from the '/v1/dubbing' endpoint with studio enabled, returns the dubbing resource.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.get("dubbing_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.<a href="/src/api/resources/dubbing/resources/resource/client/Client.ts">migrateSegments</a>(dubbing_id, { ...params }) -> ElevenLabs.SegmentMigrationResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Change the attribution of one or more segments to a different speaker.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.migrateSegments("dubbing_id", {
    segmentIds: ["segment_ids"],
    speakerId: "speaker_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.BodyMoveSegmentsBetweenSpeakersV1DubbingResourceDubbingIdMigrateSegmentsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.<a href="/src/api/resources/dubbing/resources/resource/client/Client.ts">transcribe</a>(dubbing_id, { ...params }) -> ElevenLabs.SegmentTranscriptionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Regenerate the transcriptions for the specified segments. Does not automatically regenerate translations or dubs.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.transcribe("dubbing_id", {
    segments: ["segments"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.BodyTranscribesSegmentsV1DubbingResourceDubbingIdTranscribePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.<a href="/src/api/resources/dubbing/resources/resource/client/Client.ts">translate</a>(dubbing_id, { ...params }) -> ElevenLabs.SegmentTranslationResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Regenerate the translations for either the entire resource or the specified segments/languages. Will automatically transcribe missing transcriptions. Will not automatically regenerate the dubs.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.translate("dubbing_id", {
    segments: ["segments"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.BodyTranslatesAllOrSomeSegmentsAndLanguagesV1DubbingResourceDubbingIdTranslatePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.<a href="/src/api/resources/dubbing/resources/resource/client/Client.ts">dub</a>(dubbing_id, { ...params }) -> ElevenLabs.SegmentDubResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Regenerate the dubs for either the entire resource or the specified segments/languages. Will automatically transcribe and translate any missing transcriptions and translations.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.dub("dubbing_id", {
    segments: ["segments"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.BodyDubsAllOrSomeSegmentsAndLanguagesV1DubbingResourceDubbingIdDubPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.<a href="/src/api/resources/dubbing/resources/resource/client/Client.ts">render</a>(dubbing_id, language, { ...params }) -> ElevenLabs.DubbingRenderResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Regenerate the output media for a language using the latest Studio state. Please ensure all segments have been dubbed before rendering, otherwise they will be omitted. Renders are generated asynchronously, and to check the status of all renders please use the 'Get Dubbing Resource' endpoint.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.render("dubbing_id", "language", {
    renderType: "mp4"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language:** `string` — The target language code to render, eg. 'es'. To render the source track use 'original'.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.BodyRenderAudioOrVideoForTheGivenLanguageV1DubbingResourceDubbingIdRenderLanguagePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourceClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Audio
<details><summary><code>client.dubbing.audio.<a href="/src/api/resources/dubbing/resources/audio/client/Client.ts">get</a>(dubbing_id, language_code) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns dub as a streamed MP3 or MP4 file. If this dub has been edited using Dubbing Studio you need to use the resource render endpoint as this endpoint only returns the original automatic dub result.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.audio.get("dubbing_id", "language_code");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_code:** `string` — ID of the language.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Transcript
<details><summary><code>client.dubbing.transcript.<a href="/src/api/resources/dubbing/resources/transcript/client/Client.ts">getTranscriptForDub</a>(dubbing_id, language_code, { ...params }) -> ElevenLabs.TranscriptGetTranscriptForDubResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns transcript for the dub as an SRT or WEBVTT file.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.transcript.getTranscriptForDub("dubbing_id", "source", {
    formatType: "srt"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_code:** `string` — ISO-693 language code to retrieve the transcript for. Use 'source' to fetch the transcript of the original media.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.TranscriptGetTranscriptForDubRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Transcripts
<details><summary><code>client.dubbing.transcripts.<a href="/src/api/resources/dubbing/resources/transcripts/client/Client.ts">get</a>(dubbing_id, language_code, format_type) -> ElevenLabs.DubbingTranscriptsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch the transcript for one of the languages in a dub.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.transcripts.get("dubbing_id", "source", "srt");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_code:** `string` — ISO-693 language code to retrieve the transcript for. Use 'source' to fetch the transcript of the original media.
    
</dd>
</dl>

<dl>
<dd>

**format_type:** `ElevenLabs.TranscriptsGetRequestFormatType` — Format to return transcript in. For subtitles use either 'srt' or 'webvtt', and for a full transcript use 'json'. The 'json' format is not yet supported for Dubbing Studio.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Project Language
<details><summary><code>client.dubbing.project.language.<a href="/src/api/resources/dubbing/resources/project/resources/language/client/Client.ts">list</a>(project_id, { ...params }) -> ElevenLabs.DubbingLanguageListResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

List a project's language targets (cursor-paginated).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.language.list("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", {
    pageSize: 20
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the parent dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.project.LanguageListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LanguageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.language.<a href="/src/api/resources/dubbing/resources/project/resources/language/client/Client.ts">create</a>(project_id, { ...params }) -> ElevenLabs.DubbingLanguageResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Queue a language target for a project (starts once the project is ready).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.language.create("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", {
    targetLanguage: "es",
    modelId: "dubbing_v2"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the parent dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.project.BodyCreateDubbingLanguageTargetV1DubbingProjectProjectIdLanguagePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LanguageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.language.<a href="/src/api/resources/dubbing/resources/project/resources/language/client/Client.ts">get</a>(project_id, language_id) -> ElevenLabs.DubbingLanguageResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Full language-target detail.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.language.get("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", "lang_1001kwkyxp0je6ktn4knsfrasx5s");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the parent dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_id:** `string` — Identifier of the language target to fetch.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LanguageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.language.<a href="/src/api/resources/dubbing/resources/project/resources/language/client/Client.ts">delete</a>(project_id, language_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a language target.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.language.delete("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", "lang_1001kwkyxp0je6ktn4knsfrasx5s");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the parent dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_id:** `string` — Identifier of the language target to delete.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LanguageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Project Transcript
<details><summary><code>client.dubbing.project.transcript.<a href="/src/api/resources/dubbing/resources/project/resources/transcript/client/Client.ts">get</a>(project_id) -> ElevenLabs.DubbingSourceTranscriptResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

The project's source transcript, as editable segments.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.transcript.get("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.transcript.<a href="/src/api/resources/dubbing/resources/project/resources/transcript/client/Client.ts">deleteSegment</a>(project_id, segment_id) -> ElevenLabs.DubbingTranscriptRevisionResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Remove a source segment from the transcript.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.transcript.deleteSegment("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", "0199a3f0-1c2d-7abc-8def-0123456789ab");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**segment_id:** `string` — Identifier of the segment to remove.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.transcript.<a href="/src/api/resources/dubbing/resources/project/resources/transcript/client/Client.ts">updateSegment</a>(project_id, segment_id, { ...params }) -> ElevenLabs.DubbingSourceSegmentUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Edit a source segment's text, speaker, or timing.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.transcript.updateSegment("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", "0199a3f0-1c2d-7abc-8def-0123456789ab", {
    text: "Welcome to our latest product demo."
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**segment_id:** `string` — Identifier of the segment to edit.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.project.DubbingSegmentUpdateRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.transcript.<a href="/src/api/resources/dubbing/resources/project/resources/transcript/client/Client.ts">createSegment</a>(project_id, { ...params }) -> ElevenLabs.DubbingSourceSegmentUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Add a new source segment to the transcript.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.transcript.createSegment("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", {
    text: "Thanks for watching.",
    speakerId: "default_speaker",
    startS: 42,
    endS: 44
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.project.DubbingSegmentCreateRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Project Language Transcript
<details><summary><code>client.dubbing.project.language.transcript.<a href="/src/api/resources/dubbing/resources/project/resources/language/resources/transcript/client/Client.ts">get</a>(project_id, language_id) -> ElevenLabs.DubbingTargetTranscriptResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

A language target's transcript: source segments with their translations.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.language.transcript.get("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", "lang_1001kwkyxp0je6ktn4knsfrasx5s");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_id:** `string` — Identifier of the language target.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.language.transcript.<a href="/src/api/resources/dubbing/resources/project/resources/language/resources/transcript/client/Client.ts">updateSegment</a>(project_id, language_id, segment_id, { ...params }) -> ElevenLabs.DubbingTargetSegmentUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Edit a segment's translation for a language target.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.language.transcript.updateSegment("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", "lang_1001kwkyxp0je6ktn4knsfrasx5s", "0199a3f0-1c2d-7abc-8def-0123456789ab", {
    translation: "Bienvenido a nuestra \u00FAltima demostraci\u00F3n de producto."
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_id:** `string` — Identifier of the language target.
    
</dd>
</dl>

<dl>
<dd>

**segment_id:** `string` — Identifier of the segment to edit.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.project.language.DubbingTargetSegmentUpdateRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.project.language.transcript.<a href="/src/api/resources/dubbing/resources/project/resources/language/resources/transcript/client/Client.ts">regenerate</a>(project_id, language_id) -> ElevenLabs.DubbingLanguageResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Re-dub a target from its edited transcript (charged like a generation).
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.project.language.transcript.regenerate("proj_1601kwkyxp0hfzvtmyxwqxx6mcy3", "lang_1001kwkyxp0je6ktn4knsfrasx5s");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — Identifier of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**language_id:** `string` — Identifier of the language target.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Resource Language
<details><summary><code>client.dubbing.resource.language.<a href="/src/api/resources/dubbing/resources/resource/resources/language/client/Client.ts">add</a>(dubbing_id, { ...params }) -> ElevenLabs.LanguageAddedResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Adds the given ElevenLab Turbo V2/V2.5 language code to the resource. Does not automatically generate transcripts/translations/audio.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.language.add("dubbing_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.resource.BodyAddALanguageToTheResourceV1DubbingResourceDubbingIdLanguagePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LanguageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Resource Segment
<details><summary><code>client.dubbing.resource.segment.<a href="/src/api/resources/dubbing/resources/resource/resources/segment/client/Client.ts">update</a>(dubbing_id, segment_id, language, { ...params }) -> ElevenLabs.SegmentUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Modifies a single segment with new text and/or start/end times. Will update the values for only a specific language of a segment. Does not automatically regenerate the dub.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.segment.update("dubbing_id", "segment_id", "language");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**segment_id:** `string` — ID of the segment
    
</dd>
</dl>

<dl>
<dd>

**language:** `string` — ID of the language.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.resource.SegmentUpdatePayload` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SegmentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.segment.<a href="/src/api/resources/dubbing/resources/resource/resources/segment/client/Client.ts">delete</a>(dubbing_id, segment_id) -> ElevenLabs.SegmentDeleteResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes a single segment from the dubbing.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.segment.delete("dubbing_id", "segment_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**segment_id:** `string` — ID of the segment
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SegmentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Resource Speaker
<details><summary><code>client.dubbing.resource.speaker.<a href="/src/api/resources/dubbing/resources/resource/resources/speaker/client/Client.ts">update</a>(dubbing_id, speaker_id, { ...params }) -> ElevenLabs.SpeakerUpdatedResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Amend the metadata associated with a speaker, such as their voice. Both voice cloning and using voices from the ElevenLabs library are supported.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.speaker.update("dubbing_id", "speaker_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**speaker_id:** `string` — ID of the speaker.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.resource.BodyUpdateMetadataForASpeakerV1DubbingResourceDubbingIdSpeakerSpeakerIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeakerClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.speaker.<a href="/src/api/resources/dubbing/resources/resource/resources/speaker/client/Client.ts">create</a>(dubbing_id, { ...params }) -> ElevenLabs.SpeakerCreatedResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new speaker in a dubbing resource. The speaker is added to every available language and can optionally be associated with an ElevenLabs voice and voice settings.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.speaker.create("dubbing_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.resource.BodyCreateANewSpeakerV1DubbingResourceDubbingIdSpeakerPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeakerClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.dubbing.resource.speaker.<a href="/src/api/resources/dubbing/resources/resource/resources/speaker/client/Client.ts">findSimilarVoices</a>(dubbing_id, speaker_id) -> ElevenLabs.SimilarVoicesForSpeakerResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Fetch the top 10 similar voices to a speaker, including the voice IDs, names, descriptions, and, where possible, a sample audio recording.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.speaker.findSimilarVoices("dubbing_id", "speaker_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**speaker_id:** `string` — ID of the speaker.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeakerClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Dubbing Resource Speaker Segment
<details><summary><code>client.dubbing.resource.speaker.segment.<a href="/src/api/resources/dubbing/resources/resource/resources/speaker/resources/segment/client/Client.ts">create</a>(dubbing_id, speaker_id, { ...params }) -> ElevenLabs.SegmentCreateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new segment in dubbing resource with a start and end time for the speaker in every available language. Does not automatically generate transcripts/translations/audio.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.dubbing.resource.speaker.segment.create("dubbing_id", "speaker_id", {
    startTime: 1.1,
    endTime: 1.1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**dubbing_id:** `string` — ID of the dubbing project.
    
</dd>
</dl>

<dl>
<dd>

**speaker_id:** `string` — ID of the speaker.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.dubbing.resource.speaker.SegmentCreatePayload` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SegmentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Music CompositionPlan
<details><summary><code>client.music.compositionPlan.<a href="/src/api/resources/music/resources/compositionPlan/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.CompositionPlanCreateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a composition plan for music generation. Usage of this endpoint does not cost any credits but is subject to rate limiting depending on your tier.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.music.compositionPlan.create({
    prompt: "prompt"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.music.BodyGenerateCompositionPlanV1MusicPlanPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `CompositionPlanClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Productions Orders
<details><summary><code>client.productions.orders.<a href="/src/api/resources/productions/resources/orders/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.ListOrdersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Lists Productions orders in the workspace. Supports filtering by status and date range, with pagination.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.list({
    pageSize: 1,
    offset: 1,
    status: ["open"],
    startDate: new Date("2024-01-15T09:30:00.000Z"),
    endDate: new Date("2024-01-15T09:30:00.000Z")
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.productions.OrdersListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `OrdersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.productions.orders.<a href="/src/api/resources/productions/resources/orders/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.CreateOrderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new Productions order in the workspace. The order starts in the open state and can be configured with items before submission.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.create({
    sandbox: false
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.CreateOrderRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `OrdersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.productions.orders.<a href="/src/api/resources/productions/resources/orders/client/Client.ts">get</a>(order_id) -> ElevenLabs.OrderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieves full details for a Productions order.

Quote and pricing information may not be available immediately; if you wish to see the quote before submission, you may need to poll the order details until it is ready.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.get("order_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` — The ID of the order.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `OrdersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.productions.orders.<a href="/src/api/resources/productions/resources/orders/client/Client.ts">update</a>(order_id, { ...params }) -> ElevenLabs.UpdateOrderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates an open order.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.update("order_id", {
    request: {
        name: "Spanish Dubs"
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` — The ID of the order.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.productions.BodyUpdateOrderV1ProductionsOrdersOrderIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `OrdersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.productions.orders.<a href="/src/api/resources/productions/resources/orders/client/Client.ts">submit</a>(order_id) -> ElevenLabs.SubmitOrderResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Submits an open order for processing. The order must have at least one item. Once submitted, items can no longer be modified.

Upon submission, the workspace will be charged for the order. The quote is based on information extracted from the uploaded media, such as its duration. The quote may not be available immediately; if you wish to see the quote before submission, you may need to poll the order details until the quote is ready.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.submit("order_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` — The ID of the order.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `OrdersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Productions Orders Media
<details><summary><code>client.productions.orders.media.<a href="/src/api/resources/productions/resources/orders/resources/media/client/Client.ts">register</a>(order_id, { ...params }) -> ElevenLabs.RegisterMediaResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Registers a media file with an order, either by uploading it directly or by providing a URL to fetch it from. Exactly one of `media` or `media_url` must be provided. The registered media can then be referenced when adding order items.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.media.register("order_id", {
    declaredLanguage: "declared_language"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.productions.orders.BodyRegisterMediaV1ProductionsOrdersOrderIdMediaPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MediaClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.productions.orders.media.<a href="/src/api/resources/productions/resources/orders/resources/media/client/Client.ts">get</a>(order_id, media_id) -> ElevenLabs.OrderMediaResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieves metadata and a time-limited download URL for a previously uploaded media file.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.media.get("order_id", "media_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` — The ID of the order.
    
</dd>
</dl>

<dl>
<dd>

**media_id:** `ElevenLabs.MediaId` — The ID of the media file.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MediaClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Productions Orders Items
<details><summary><code>client.productions.orders.items.<a href="/src/api/resources/productions/resources/orders/resources/items/client/Client.ts">upsert</a>(order_id, { ...params }) -> ElevenLabs.UpsertOrderItemResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Adds or updates an order item on an open order. Returns the item ID and the quoted price.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.items.upsert("order_id", {
    request: {
        item: {
            kind: "dub",
            mediaId: "prodmedia_01jgatk6h0fwxrtbjade61yqhx",
            sourceLanguage: "en",
            destinationLanguages: ["hi", "fr-FR", "de"],
            includeCaptions: true,
            includeSourceCaptions: false,
            instructions: "Voices don't need to match the originals, prioritize native-sounding voices",
            captionsSdh: false
        }
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` — The ID of the order.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.productions.orders.BodyUpsertOrderItemV1ProductionsOrdersOrderIdItemsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ItemsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.productions.orders.items.<a href="/src/api/resources/productions/resources/orders/resources/items/client/Client.ts">remove</a>(order_id, item_id) -> ElevenLabs.RemoveOrderItemResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Removes an order item from an open order.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.items.remove("order_id", "item_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` — The ID of the order.
    
</dd>
</dl>

<dl>
<dd>

**item_id:** `ElevenLabs.ItemId` — The ID of the order item.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ItemsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Productions Orders Deliverables
<details><summary><code>client.productions.orders.deliverables.<a href="/src/api/resources/productions/resources/orders/resources/deliverables/client/Client.ts">list</a>(order_id) -> ElevenLabs.OrderDeliverablesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieves the delivered files for a completed order. Returns an empty list if the order is not yet completed.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.deliverables.list("order_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_id:** `ElevenLabs.OrderId` — The ID of the order.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `DeliverablesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Productions Orders Languages
<details><summary><code>client.productions.orders.languages.<a href="/src/api/resources/productions/resources/orders/resources/languages/client/Client.ts">list</a>(order_item_kind) -> ElevenLabs.LanguagesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the available languages for a given order item kind.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.productions.orders.languages.list("dub");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**order_item_kind:** `ElevenLabs.OrderItemKind` — The kind of order item.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `LanguagesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## PronunciationDictionaries Rules
<details><summary><code>client.pronunciationDictionaries.rules.<a href="/src/api/resources/pronunciationDictionaries/resources/rules/client/Client.ts">set</a>(pronunciation_dictionary_id, { ...params }) -> ElevenLabs.PronunciationDictionaryRulesResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Replaces all existing rules on the pronunciation dictionary with the provided ones.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.rules.set("21m00Tcm4TlvDq8ikWAM", {
    rules: [{
            type: "alias",
            stringToReplace: "Thailand",
            caseSensitive: true,
            wordBoundaries: true,
            alias: "tie-land"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**pronunciation_dictionary_id:** `string` — The id of the pronunciation dictionary
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.pronunciationDictionaries.BodySetRulesOnThePronunciationDictionaryV1PronunciationDictionariesPronunciationDictionaryIdSetRulesPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `RulesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pronunciationDictionaries.rules.<a href="/src/api/resources/pronunciationDictionaries/resources/rules/client/Client.ts">add</a>(pronunciation_dictionary_id, { ...params }) -> ElevenLabs.PronunciationDictionaryRulesResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Add rules to the pronunciation dictionary. If a rule with the same string_to_replace already exists, it will be replaced.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.rules.add("21m00Tcm4TlvDq8ikWAM", {
    rules: [{
            type: "alias",
            stringToReplace: "Thailand",
            caseSensitive: true,
            wordBoundaries: true,
            alias: "tie-land"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**pronunciation_dictionary_id:** `string` — The id of the pronunciation dictionary
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.pronunciationDictionaries.PronunciationDictionary` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `RulesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pronunciationDictionaries.rules.<a href="/src/api/resources/pronunciationDictionaries/resources/rules/client/Client.ts">remove</a>(pronunciation_dictionary_id, { ...params }) -> ElevenLabs.PronunciationDictionaryRulesResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Remove rules from the pronunciation dictionary
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pronunciationDictionaries.rules.remove("21m00Tcm4TlvDq8ikWAM", {
    ruleStrings: ["rule_strings"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**pronunciation_dictionary_id:** `string` — The id of the pronunciation dictionary
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.pronunciationDictionaries.RemovePronunciationDictionaryRulesRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `RulesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## ServiceAccounts ApiKeys
<details><summary><code>client.serviceAccounts.apiKeys.<a href="/src/api/resources/serviceAccounts/resources/apiKeys/client/Client.ts">list</a>(service_account_user_id) -> ElevenLabs.WorkspaceApiKeyListResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all API keys for a service account
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.serviceAccounts.apiKeys.list("service_account_user_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**service_account_user_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.serviceAccounts.apiKeys.<a href="/src/api/resources/serviceAccounts/resources/apiKeys/client/Client.ts">create</a>(service_account_user_id, { ...params }) -> ElevenLabs.WorkspaceCreateApiKeyResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new API key for a service account
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.serviceAccounts.apiKeys.create("service_account_user_id", {
    name: "name",
    permissions: "all"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**service_account_user_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.serviceAccounts.BodyCreateServiceAccountApiKeyV1ServiceAccountsServiceAccountUserIdApiKeysPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.serviceAccounts.apiKeys.<a href="/src/api/resources/serviceAccounts/resources/apiKeys/client/Client.ts">delete</a>(service_account_user_id, api_key_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete an existing API key for a service account
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.serviceAccounts.apiKeys.delete("service_account_user_id", "api_key_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**service_account_user_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**api_key_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.serviceAccounts.apiKeys.<a href="/src/api/resources/serviceAccounts/resources/apiKeys/client/Client.ts">update</a>(service_account_user_id, api_key_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update an existing API key for a service account
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.serviceAccounts.apiKeys.update("service_account_user_id", "api_key_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**service_account_user_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**api_key_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.serviceAccounts.BodyEditServiceAccountApiKeyV1ServiceAccountsServiceAccountUserIdApiKeysApiKeyIdPatch` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## SpeechToText Transcripts
<details><summary><code>client.speechToText.transcripts.<a href="/src/api/resources/speechToText/resources/transcripts/client/Client.ts">get</a>(transcription_id) -> ElevenLabs.TranscriptsGetResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve a previously generated transcript by its ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechToText.transcripts.get("transcription_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**transcription_id:** `string` — The unique ID of the transcript to retrieve
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.speechToText.transcripts.<a href="/src/api/resources/speechToText/resources/transcripts/client/Client.ts">delete</a>(transcription_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a previously generated transcript by its ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.speechToText.transcripts.delete("transcription_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**transcription_id:** `string` — The unique ID of the transcript to delete
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `TranscriptsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Studio Projects
<details><summary><code>client.studio.projects.<a href="/src/api/resources/studio/resources/projects/client/Client.ts">list</a>() -> ElevenLabs.GetProjectsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of your Studio projects with metadata.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `ProjectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.<a href="/src/api/resources/studio/resources/projects/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.AddProjectResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new Studio project, it can be either initialized as blank, from a document or from a URL.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.create({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.studio.BodyCreateStudioProjectV1StudioProjectsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.<a href="/src/api/resources/studio/resources/projects/client/Client.ts">get</a>(project_id, { ...params }) -> ElevenLabs.ProjectExtendedResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns information about a specific Studio project. This endpoint returns more detailed information about a project than `GET /v1/studio`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.get("21m00Tcm4TlvDq8ikWAM", {
    shareId: "share_id"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.ProjectsGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.<a href="/src/api/resources/studio/resources/projects/client/Client.ts">update</a>(project_id, { ...params }) -> ElevenLabs.EditProjectResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates the specified Studio project by setting the values of the parameters passed.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.update("21m00Tcm4TlvDq8ikWAM", {
    name: "Project 1",
    defaultTitleVoiceId: "21m00Tcm4TlvDq8ikWAM",
    defaultParagraphVoiceId: "21m00Tcm4TlvDq8ikWAM"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.BodyUpdateStudioProjectV1StudioProjectsProjectIdPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.<a href="/src/api/resources/studio/resources/projects/client/Client.ts">delete</a>(project_id) -> ElevenLabs.DeleteProjectResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes a Studio project.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.delete("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.<a href="/src/api/resources/studio/resources/projects/client/Client.ts">convert</a>(project_id) -> ElevenLabs.ConvertProjectResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Starts conversion of a Studio project and all of its chapters.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.convert("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.<a href="/src/api/resources/studio/resources/projects/client/Client.ts">getMutedTracks</a>(project_id) -> ElevenLabs.ProjectMutedTracksResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of chapter IDs that have muted tracks in a project.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.getMutedTracks("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the Studio project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProjectsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Studio Projects PronunciationDictionaries
<details><summary><code>client.studio.projects.pronunciationDictionaries.<a href="/src/api/resources/studio/resources/projects/resources/pronunciationDictionaries/client/Client.ts">create</a>(project_id, { ...params }) -> ElevenLabs.CreatePronunciationDictionaryResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a set of pronunciation dictionaries acting on a project. This will automatically mark text within this project as requiring reconverting where the new dictionary would apply or the old one no longer does.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.pronunciationDictionaries.create("21m00Tcm4TlvDq8ikWAM", {
    pronunciationDictionaryLocators: [{
            pronunciationDictionaryId: "pronunciation_dictionary_id"
        }]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.projects.BodyCreatePronunciationDictionariesV1StudioProjectsProjectIdPronunciationDictionariesPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PronunciationDictionariesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Studio Projects Content
<details><summary><code>client.studio.projects.content.<a href="/src/api/resources/studio/resources/projects/resources/content/client/Client.ts">update</a>(project_id, { ...params }) -> ElevenLabs.EditProjectResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates Studio project content.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.content.update("21m00Tcm4TlvDq8ikWAM", {});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.projects.BodyUpdateStudioProjectContentV1StudioProjectsProjectIdContentPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ContentClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Studio Projects Snapshots
<details><summary><code>client.studio.projects.snapshots.<a href="/src/api/resources/studio/resources/projects/resources/snapshots/client/Client.ts">list</a>(project_id) -> ElevenLabs.ProjectSnapshotsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieves a list of snapshots for a Studio project.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.snapshots.list("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the Studio project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SnapshotsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.snapshots.<a href="/src/api/resources/studio/resources/projects/resources/snapshots/client/Client.ts">get</a>(project_id, project_snapshot_id) -> ElevenLabs.ProjectSnapshotExtendedResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the project snapshot.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.snapshots.get("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the Studio project.
    
</dd>
</dl>

<dl>
<dd>

**project_snapshot_id:** `string` — The ID of the Studio project snapshot.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SnapshotsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.snapshots.<a href="/src/api/resources/studio/resources/projects/resources/snapshots/client/Client.ts">stream</a>(project_id, project_snapshot_id, { ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Stream the audio from a Studio project snapshot.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.snapshots.stream("project_id", "project_snapshot_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**project_snapshot_id:** `string` — The ID of the Studio project snapshot.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.projects.BodyStreamStudioProjectAudioV1StudioProjectsProjectIdSnapshotsProjectSnapshotIdStreamPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SnapshotsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.snapshots.<a href="/src/api/resources/studio/resources/projects/resources/snapshots/client/Client.ts">streamArchive</a>(project_id, project_snapshot_id) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a compressed archive of the Studio project's audio.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.snapshots.streamArchive("project_id", "project_snapshot_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**project_snapshot_id:** `string` — The ID of the Studio project snapshot.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SnapshotsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Studio Projects Chapters
<details><summary><code>client.studio.projects.chapters.<a href="/src/api/resources/studio/resources/projects/resources/chapters/client/Client.ts">list</a>(project_id) -> ElevenLabs.GetChaptersResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of a Studio project's chapters.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.list("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the Studio project.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChaptersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.chapters.<a href="/src/api/resources/studio/resources/projects/resources/chapters/client/Client.ts">create</a>(project_id, { ...params }) -> ElevenLabs.AddChapterResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new chapter either as blank or from a URL.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.create("21m00Tcm4TlvDq8ikWAM", {
    name: "Chapter 1"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the Studio project.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.projects.BodyCreateChapterV1StudioProjectsProjectIdChaptersPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChaptersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.chapters.<a href="/src/api/resources/studio/resources/projects/resources/chapters/client/Client.ts">get</a>(project_id, chapter_id) -> ElevenLabs.ChapterWithContentResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns information about a specific chapter.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.get("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**chapter_id:** `string` — The ID of the chapter to be used. You can use the [List project chapters](/docs/api-reference/studio/get-chapters) endpoint to list all the available chapters.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChaptersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.chapters.<a href="/src/api/resources/studio/resources/projects/resources/chapters/client/Client.ts">update</a>(project_id, chapter_id, { ...params }) -> ElevenLabs.EditChapterResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates a chapter.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.update("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**chapter_id:** `string` — The ID of the chapter to be used. You can use the [List project chapters](/docs/api-reference/studio/get-chapters) endpoint to list all the available chapters.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.projects.BodyUpdateChapterV1StudioProjectsProjectIdChaptersChapterIdPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChaptersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.chapters.<a href="/src/api/resources/studio/resources/projects/resources/chapters/client/Client.ts">delete</a>(project_id, chapter_id) -> ElevenLabs.DeleteChapterResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes a chapter.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.delete("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**chapter_id:** `string` — The ID of the chapter to be used. You can use the [List project chapters](/docs/api-reference/studio/get-chapters) endpoint to list all the available chapters.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChaptersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.chapters.<a href="/src/api/resources/studio/resources/projects/resources/chapters/client/Client.ts">convert</a>(project_id, chapter_id) -> ElevenLabs.ConvertChapterResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Starts conversion of a specific chapter.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.convert("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**chapter_id:** `string` — The ID of the chapter to be used. You can use the [List project chapters](/docs/api-reference/studio/get-chapters) endpoint to list all the available chapters.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChaptersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Studio Projects Chapters Snapshots
<details><summary><code>client.studio.projects.chapters.snapshots.<a href="/src/api/resources/studio/resources/projects/resources/chapters/resources/snapshots/client/Client.ts">list</a>(project_id, chapter_id) -> ElevenLabs.ChapterSnapshotsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets information about all the snapshots of a chapter. Each snapshot can be downloaded as audio. Whenever a chapter is converted a snapshot will automatically be created.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.snapshots.list("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**chapter_id:** `string` — The ID of the chapter to be used. You can use the [List project chapters](/docs/api-reference/studio/get-chapters) endpoint to list all the available chapters.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SnapshotsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.chapters.snapshots.<a href="/src/api/resources/studio/resources/projects/resources/chapters/resources/snapshots/client/Client.ts">get</a>(project_id, chapter_id, chapter_snapshot_id) -> ElevenLabs.ChapterSnapshotExtendedResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the chapter snapshot.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.snapshots.get("21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM", "21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the Studio project.
    
</dd>
</dl>

<dl>
<dd>

**chapter_id:** `string` — The ID of the chapter.
    
</dd>
</dl>

<dl>
<dd>

**chapter_snapshot_id:** `string` — The ID of the chapter snapshot.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SnapshotsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.studio.projects.chapters.snapshots.<a href="/src/api/resources/studio/resources/projects/resources/chapters/resources/snapshots/client/Client.ts">stream</a>(project_id, chapter_id, chapter_snapshot_id, { ...params }) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Stream the audio from a chapter snapshot. Use `GET /v1/studio/projects/{project_id}/chapters/{chapter_id}/snapshots` to return the snapshots of a chapter.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.studio.projects.chapters.snapshots.stream("project_id", "chapter_id", "chapter_snapshot_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**project_id:** `string` — The ID of the project to be used. You can use the [List projects](/docs/api-reference/studio/get-projects) endpoint to list all the available projects.
    
</dd>
</dl>

<dl>
<dd>

**chapter_id:** `string` — The ID of the chapter to be used. You can use the [List project chapters](/docs/api-reference/studio/get-chapters) endpoint to list all the available chapters.
    
</dd>
</dl>

<dl>
<dd>

**chapter_snapshot_id:** `string` — The ID of the chapter snapshot to be used. You can use the [List project chapter snapshots](/docs/api-reference/studio/get-snapshots) endpoint to list all the available snapshots.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.studio.projects.chapters.BodyStreamChapterAudioV1StudioProjectsProjectIdChaptersChapterIdSnapshotsChapterSnapshotIdStreamPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SnapshotsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## TextToVoice Preview
<details><summary><code>client.textToVoice.preview.<a href="/src/api/resources/textToVoice/resources/preview/client/Client.ts">stream</a>(generated_voice_id) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Stream a voice preview that was created via the /v1/text-to-voice/design endpoint.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.textToVoice.preview.stream("generated_voice_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**generated_voice_id:** `string` — The generated_voice_id to stream.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PreviewClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Tokens SingleUse
<details><summary><code>client.tokens.singleUse.<a href="/src/api/resources/tokens/resources/singleUse/client/Client.ts">create</a>(token_type) -> ElevenLabs.SingleUseTokenResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Generate a time limited single-use token with embedded authentication for frontend clients.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.tokens.singleUse.create("realtime_scribe");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**token_type:** `ElevenLabs.SingleUseTokenType` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SingleUseClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## User Subscription
<details><summary><code>client.user.subscription.<a href="/src/api/resources/user/resources/subscription/client/Client.ts">get</a>() -> ElevenLabs.Subscription</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets extended information about the users subscription
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.user.subscription.get();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SubscriptionClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Settings
<details><summary><code>client.voices.settings.<a href="/src/api/resources/voices/resources/settings/client/Client.ts">getDefault</a>() -> ElevenLabs.VoiceSettings</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets the default settings for voices. "similarity_boost" corresponds to"Clarity + Similarity Enhancement" in the web app and "stability" corresponds to "Stability" slider in the web app.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.settings.getDefault();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `SettingsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.settings.<a href="/src/api/resources/voices/resources/settings/client/Client.ts">get</a>(voice_id) -> ElevenLabs.VoiceSettings</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the settings for a specific voice. "similarity_boost" corresponds to"Clarity + Similarity Enhancement" in the web app and "stability" corresponds to "Stability" slider in the web app.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.settings.get("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SettingsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.settings.<a href="/src/api/resources/voices/resources/settings/client/Client.ts">update</a>(voice_id, { ...params }) -> ElevenLabs.EditVoiceSettingsResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Edit your settings for a specific voice. "similarity_boost" corresponds to "Clarity + Similarity Enhancement" in the web app and "stability" corresponds to "Stability" slider in the web app.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.settings.update("21m00Tcm4TlvDq8ikWAM", {
    stability: 1,
    useSpeakerBoost: true,
    similarityBoost: 1,
    style: 0,
    speed: 1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. You can use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.VoiceSettings` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SettingsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Ivc
<details><summary><code>client.voices.ivc.<a href="/src/api/resources/voices/resources/ivc/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.AddVoiceIvcResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a voice clone and add it to your Voices
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.ivc.create({
    files: [fs.createReadStream("/path/to/your/file")],
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.voices.BodyAddVoiceV1VoicesAddPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `IvcClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc
<details><summary><code>client.voices.pvc.<a href="/src/api/resources/voices/resources/pvc/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.AddVoiceResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a new PVC voice with metadata but no samples
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.create({
    name: "John Smith",
    language: "en"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.voices.CreatePvcVoiceRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PvcClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.pvc.<a href="/src/api/resources/voices/resources/pvc/client/Client.ts">update</a>(voice_id, { ...params }) -> ElevenLabs.AddVoiceResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Edit PVC voice metadata
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.update("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.voices.BodyEditPvcVoiceV1VoicesPvcVoiceIdPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PvcClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.pvc.<a href="/src/api/resources/voices/resources/pvc/client/Client.ts">train</a>(voice_id, { ...params }) -> ElevenLabs.StartPvcVoiceTrainingResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Start PVC training process for a voice.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.train("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.voices.BodyRunPvcTrainingV1VoicesPvcVoiceIdTrainPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PvcClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc Samples
<details><summary><code>client.voices.pvc.samples.<a href="/src/api/resources/voices/resources/pvc/resources/samples/client/Client.ts">create</a>(voice_id, { ...params }) -> ElevenLabs.VoiceSample[]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Add audio samples to a PVC voice
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.create("21m00Tcm4TlvDq8ikWAM", {
    files: [fs.createReadStream("/path/to/your/file")]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.voices.pvc.BodyAddSamplesToPvcVoiceV1VoicesPvcVoiceIdSamplesPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SamplesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.pvc.samples.<a href="/src/api/resources/voices/resources/pvc/resources/samples/client/Client.ts">update</a>(voice_id, sample_id, { ...params }) -> ElevenLabs.AddVoiceResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update a PVC voice sample - apply noise removal, select speaker, change trim times or file name.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.update("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — Sample ID to be used
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.voices.pvc.BodyUpdatePvcVoiceSampleV1VoicesPvcVoiceIdSamplesSampleIdPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SamplesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.pvc.samples.<a href="/src/api/resources/voices/resources/pvc/resources/samples/client/Client.ts">delete</a>(voice_id, sample_id) -> ElevenLabs.DeleteVoiceSampleResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete a sample from a PVC voice.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.delete("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — Sample ID to be used
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SamplesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc Verification
<details><summary><code>client.voices.pvc.verification.<a href="/src/api/resources/voices/resources/pvc/resources/verification/client/Client.ts">request</a>(voice_id, { ...params }) -> ElevenLabs.RequestPvcManualVerificationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Request manual verification for a PVC voice.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.verification.request("21m00Tcm4TlvDq8ikWAM", {
    files: [fs.createReadStream("/path/to/your/file")]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.voices.pvc.BodyRequestManualVerificationV1VoicesPvcVoiceIdVerificationPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `VerificationClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc Samples Audio
<details><summary><code>client.voices.pvc.samples.audio.<a href="/src/api/resources/voices/resources/pvc/resources/samples/resources/audio/client/Client.ts">get</a>(voice_id, sample_id, { ...params }) -> ElevenLabs.VoiceSamplePreviewResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve the first 30 seconds of voice sample audio with or without noise removal.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.audio.get("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L", {
    removeBackgroundNoise: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — Sample ID to be used
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.voices.pvc.samples.AudioGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc Samples Waveform
<details><summary><code>client.voices.pvc.samples.waveform.<a href="/src/api/resources/voices/resources/pvc/resources/samples/resources/waveform/client/Client.ts">get</a>(voice_id, sample_id) -> ElevenLabs.VoiceSampleVisualWaveformResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve the visual waveform of a voice sample.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.waveform.get("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — Sample ID to be used
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WaveformClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc Samples Speakers
<details><summary><code>client.voices.pvc.samples.speakers.<a href="/src/api/resources/voices/resources/pvc/resources/samples/resources/speakers/client/Client.ts">get</a>(voice_id, sample_id) -> ElevenLabs.SpeakerSeparationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve the status of the speaker separation process and the list of detected speakers if complete.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.speakers.get("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — Sample ID to be used
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeakersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.pvc.samples.speakers.<a href="/src/api/resources/voices/resources/pvc/resources/samples/resources/speakers/client/Client.ts">separate</a>(voice_id, sample_id) -> ElevenLabs.StartSpeakerSeparationResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Start speaker separation process for a sample
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.speakers.separate("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — Sample ID to be used
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SpeakersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc Samples Speakers Audio
<details><summary><code>client.voices.pvc.samples.speakers.audio.<a href="/src/api/resources/voices/resources/pvc/resources/samples/resources/speakers/resources/audio/client/Client.ts">get</a>(voice_id, sample_id, speaker_id) -> ElevenLabs.SpeakerAudioResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Retrieve the separated audio for a specific speaker.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.samples.speakers.audio.get("21m00Tcm4TlvDq8ikWAM", "VW7YKqPnjY4h39yTbx2L", "VW7YKqPnjY4h39yTbx2L");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — Sample ID to be used
    
</dd>
</dl>

<dl>
<dd>

**speaker_id:** `string` — Speaker ID to be used, you can use GET https://api.elevenlabs.io/v1/voices/{voice_id}/samples/{sample_id}/speakers to list all the available speakers for a sample.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Pvc Verification Captcha
<details><summary><code>client.voices.pvc.verification.captcha.<a href="/src/api/resources/voices/resources/pvc/resources/verification/resources/captcha/client/Client.ts">get</a>(voice_id) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get captcha for PVC voice verification.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.verification.captcha.get("21m00Tcm4TlvDq8ikWAM");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `CaptchaClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.voices.pvc.verification.captcha.<a href="/src/api/resources/voices/resources/pvc/resources/verification/resources/captcha/client/Client.ts">verify</a>(voice_id, { ...params }) -> ElevenLabs.VerifyPvcVoiceCaptchaResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Submit captcha verification for PVC voice.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.pvc.verification.captcha.verify("21m00Tcm4TlvDq8ikWAM", {
    recording: fs.createReadStream("/path/to/your/file")
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.voices.pvc.verification.BodyVerifyPvcVoiceCaptchaV1VoicesPvcVoiceIdCaptchaPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `CaptchaClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Voices Samples Audio
<details><summary><code>client.voices.samples.audio.<a href="/src/api/resources/voices/resources/samples/resources/audio/client/Client.ts">get</a>(voice_id, sample_id) -> ReadableStream&lt;Uint8Array&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the audio corresponding to a sample attached to a voice.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.voices.samples.audio.get("voice_id", "sample_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**voice_id:** `string` — ID of the voice to be used. You can use the [Get voices](/docs/api-reference/voices/search) endpoint list all the available voices.
    
</dd>
</dl>

<dl>
<dd>

**sample_id:** `string` — ID of the sample to be used. You can use the [Get voices](/docs/api-reference/voices/get) endpoint list all the available samples for a voice.
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AudioClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace AuditLogs
<details><summary><code>client.workspace.auditLogs.<a href="/src/api/resources/workspace/resources/auditLogs/client/Client.ts">list</a>({ ...params }) -> ElevenLabs.WorkspaceAuditLogsPageResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the audit log for the workspace. Requires enterprise tier and the audit_log_read permission.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.auditLogs.list({
    limit: 1,
    cursor: "cursor",
    timeFromUnixMs: 1,
    timeToUnixMs: 1,
    actorUid: "actor_uid",
    className: "class_name",
    activityName: "activity_name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.AuditLogsListRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AuditLogsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace AuthConnections
<details><summary><code>client.workspace.authConnections.<a href="/src/api/resources/workspace/resources/authConnections/client/Client.ts">list</a>() -> ElevenLabs.ListAuthConnectionsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all auth connections for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.authConnections.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `AuthConnectionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.authConnections.<a href="/src/api/resources/workspace/resources/authConnections/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.AuthConnectionsCreateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Create a new OAuth2 auth connection for the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.authConnections.create({
    authType: "oauth2_client_credentials",
    name: "name",
    provider: "provider",
    clientId: "client_id",
    tokenUrl: "token_url",
    clientSecret: "client_secret"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.AuthConnectionsCreateRequestBody` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AuthConnectionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.authConnections.<a href="/src/api/resources/workspace/resources/authConnections/client/Client.ts">delete</a>(auth_connection_id) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Delete an auth connection
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.authConnections.delete("auth_connection_id");

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**auth_connection_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AuthConnectionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.authConnections.<a href="/src/api/resources/workspace/resources/authConnections/client/Client.ts">update</a>(auth_connection_id, { ...params }) -> ElevenLabs.AuthConnectionsUpdateResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Update an auth connection
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.authConnections.update("auth_connection_id", {
    authType: "oauth2_client_credentials"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**auth_connection_id:** `string` 
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.AuthConnectionsUpdateRequestBody` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `AuthConnectionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace Groups
<details><summary><code>client.workspace.groups.<a href="/src/api/resources/workspace/resources/groups/client/Client.ts">list</a>() -> Record&lt;string, ElevenLabs.WorkspaceGroupResponseModel&gt;</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Get all groups in the workspace
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.groups.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `GroupsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.groups.<a href="/src/api/resources/workspace/resources/groups/client/Client.ts">search</a>({ ...params }) -> ElevenLabs.WorkspaceGroupByNameResponseModel[]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Searches for user groups in the workspace. Multiple or no groups may be returned.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.groups.search({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.GroupsSearchRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `GroupsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace Invites
<details><summary><code>client.workspace.invites.<a href="/src/api/resources/workspace/resources/invites/client/Client.ts">create</a>({ ...params }) -> ElevenLabs.AddWorkspaceInviteResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Sends an email invitation to join your workspace to the provided email. If the user doesn't have an account they will be prompted to create one. If the user accepts this invite they will be added as a user to your workspace and your subscription using one of your seats. This endpoint may only be called by workspace members with the WORKSPACE_MEMBERS_INVITE permission. If the user is already in the workspace a 400 error will be returned.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.invites.create({
    email: "john.doe@testmail.com"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.InviteUserRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `InvitesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.invites.<a href="/src/api/resources/workspace/resources/invites/client/Client.ts">createBatch</a>({ ...params }) -> ElevenLabs.AddWorkspaceInviteResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Sends email invitations to join your workspace to the provided emails. Requires all email addresses to be part of a verified domain. If the users don't have an account they will be prompted to create one. If the users accept these invites they will be added as users to your workspace and your subscription using one of your seats. This endpoint may only be called by workspace members with the WORKSPACE_MEMBERS_INVITE permission.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.invites.createBatch({
    emails: ["emails"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.BodyInviteMultipleUsersV1WorkspaceInvitesAddBulkPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `InvitesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.invites.<a href="/src/api/resources/workspace/resources/invites/client/Client.ts">delete</a>({ ...params }) -> ElevenLabs.DeleteWorkspaceInviteResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Invalidates an existing email invitation. The invitation will still show up in the inbox it has been delivered to, but activating it to join the workspace won't work. This endpoint may only be called by workspace members with the WORKSPACE_MEMBERS_INVITE permission.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.invites.delete({
    email: "john.doe@testmail.com"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.BodyDeleteExistingInvitationV1WorkspaceInvitesDelete` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `InvitesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace Members
<details><summary><code>client.workspace.members.<a href="/src/api/resources/workspace/resources/members/client/Client.ts">list</a>() -> ElevenLabs.WorkspaceMemberResponseModel[]</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets a list of all members of the workspace, including locked members. Service accounts are excluded. Requires the workspace_members_read permission.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.members.list();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `MembersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.members.<a href="/src/api/resources/workspace/resources/members/client/Client.ts">update</a>({ ...params }) -> ElevenLabs.UpdateWorkspaceMemberResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Updates attributes of a workspace member. Apart from the email identifier, all parameters will remain unchanged unless specified. This endpoint may only be called by workspace administrators.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.members.update({
    email: "email"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.UpdateMemberRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MembersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace Resources
<details><summary><code>client.workspace.resources.<a href="/src/api/resources/workspace/resources/resources/client/Client.ts">get</a>(resource_id, { ...params }) -> ElevenLabs.ResourceMetadataResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Gets the metadata of a resource by ID.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.resources.get("resource_id", {
    resourceType: "voice"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**resource_id:** `string` — The ID of the target resource.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.workspace.ResourcesGetRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.resources.<a href="/src/api/resources/workspace/resources/resources/client/Client.ts">share</a>(resource_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Grants a role (one of 'admin', 'editor', 'commenter', or 'viewer') on a workspace resource to a user, group, or workspace (service account) API key. This overrides any existing role the target has on the resource. To target a user or service account, pass only the user email; the user must be in your workspace. To target a group, pass only the group id. To target a workspace (service account) API key, pass the api key id; the resource will be shared with the service account associated with that key. You must have admin access to the resource to share it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.resources.share("resource_id", {
    role: "admin",
    resourceType: "voice"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**resource_id:** `string` — The ID of the target resource.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.workspace.BodyShareWorkspaceResourceV1WorkspaceResourcesResourceIdSharePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.resources.<a href="/src/api/resources/workspace/resources/resources/client/Client.ts">unshare</a>(resource_id, { ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Removes any existing role on a workspace resource from a user, group, or workspace (service account) API key. To target a user or service account, pass only the user email; the user must be in your workspace. To target a group, pass only the group id. To target a workspace (service account) API key, pass the api key id; the resource will be unshared from the service account associated with that key. You must have admin access to the resource to unshare it. You cannot remove permissions from the user who created the resource.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.resources.unshare("resource_id", {
    resourceType: "voice"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**resource_id:** `string` — The ID of the target resource.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.workspace.BodyUnshareWorkspaceResourceV1WorkspaceResourcesResourceIdUnsharePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ResourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace Usage
<details><summary><code>client.workspace.usage.<a href="/src/api/resources/workspace/resources/usage/client/Client.ts">getUsageByProductOverTime</a>({ ...params }) -> ElevenLabs.WorkspaceAnalyticsQueryResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns credit usage broken down by product type over time. The response is a tabular structure with columns, column_types, column_units, and rows.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.usage.getUsageByProductOverTime({
    startTime: 1,
    endTime: 1
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.BodyGetWorkspaceUsageV1WorkspaceAnalyticsQueryUsageByProductOverTimePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `UsageClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace Analytics Requests
<details><summary><code>client.workspace.analytics.requests.<a href="/src/api/resources/workspace/resources/analytics/resources/requests/client/Client.ts">get</a>({ ...params }) -> ElevenLabs.WorkspaceAnalyticsQueryResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a list of API requests. Supports filtering by time range, column filters, and search terms. At least one of start_time or end_time must be provided. An optional sort parameter controls timestamp ordering. Results are ordered by timestamp. Descending if end_time is used, ascending if start_time is used. The response is a tabular structure with columns, column_types, column_units, and rows.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.analytics.requests.get();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspace.analytics.BodyListApiRequestsV1WorkspaceAnalyticsRequestsPost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `RequestsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspace Groups Members
<details><summary><code>client.workspace.groups.members.<a href="/src/api/resources/workspace/resources/groups/resources/members/client/Client.ts">remove</a>(group_id, { ...params }) -> ElevenLabs.DeleteWorkspaceGroupMemberResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Removes a member from the specified group. Requires `group_members_manage` permission.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.groups.members.remove("group_id", {
    email: "email"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**group_id:** `string` — The ID of the target group.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.workspace.groups.BodyDeleteMemberFromUserGroupV1WorkspaceGroupsGroupIdMembersRemovePost` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MembersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.workspace.groups.members.<a href="/src/api/resources/workspace/resources/groups/resources/members/client/Client.ts">add</a>(group_id, { ...params }) -> ElevenLabs.AddWorkspaceGroupMemberResponseModel</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Adds a member of your workspace to the specified group. Requires `group_members_manage` permission.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspace.groups.members.add("group_id", {
    email: "email"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**group_id:** `string` — The ID of the target group.
    
</dd>
</dl>

<dl>
<dd>

**request:** `ElevenLabs.workspace.groups.AddMemberToGroupRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MembersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Workspaces ApiKeys
<details><summary><code>client.workspaces.apiKeys.<a href="/src/api/resources/workspaces/resources/apiKeys/client/Client.ts">disable</a>({ ...params }) -> unknown</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Disable the API key used to authenticate this request. Requires the query parameter `api_key_name=self` as an explicit confirmation.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.workspaces.apiKeys.disable({
    apiKeyName: "self"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `ElevenLabs.workspaces.ApiKeysDisableRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

