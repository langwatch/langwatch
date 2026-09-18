"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toNewSessionConfig = toNewSessionConfig;
exports.normalizeAudioFormat = normalizeAudioFormat;
function isDefined(key, object) {
    // @ts-expect-error fudging with types here for the index types
    return key in object && typeof object[key] !== 'undefined';
}
function isDeprecatedConfig(config) {
    return (isDefined('modalities', config) ||
        isDefined('inputAudioFormat', config) ||
        isDefined('outputAudioFormat', config) ||
        isDefined('inputAudioTranscription', config) ||
        isDefined('turnDetection', config) ||
        isDefined('inputAudioNoiseReduction', config) ||
        isDefined('speed', config));
}
/**
 * Convert any given config (old or new) to the new GA config shape.
 * If a new config is provided, it will be returned as-is (normalized shallowly).
 */
function toNewSessionConfig(config) {
    if (!isDeprecatedConfig(config)) {
        const inputConfig = config.audio?.input
            ? {
                format: normalizeAudioFormat(config.audio.input.format),
                noiseReduction: config.audio.input.noiseReduction ?? null,
                transcription: config.audio.input.transcription,
                turnDetection: config.audio.input.turnDetection,
            }
            : undefined;
        const requestedOutputVoice = config.audio?.output?.voice ?? config.voice;
        const outputConfig = config.audio?.output || typeof requestedOutputVoice !== 'undefined'
            ? {
                format: normalizeAudioFormat(config.audio?.output?.format),
                voice: requestedOutputVoice,
                speed: config.audio?.output?.speed,
            }
            : undefined;
        return {
            model: config.model,
            instructions: config.instructions,
            toolChoice: config.toolChoice,
            tools: config.tools,
            tracing: config.tracing,
            providerData: config.providerData,
            prompt: config.prompt,
            outputModalities: config.outputModalities,
            audio: inputConfig || outputConfig
                ? {
                    input: inputConfig,
                    output: outputConfig,
                }
                : undefined,
        };
    }
    return {
        model: config.model,
        instructions: config.instructions,
        toolChoice: config.toolChoice,
        tools: config.tools,
        tracing: config.tracing,
        providerData: config.providerData,
        prompt: config.prompt,
        outputModalities: config.modalities,
        audio: {
            input: {
                format: normalizeAudioFormat(config.inputAudioFormat),
                noiseReduction: config.inputAudioNoiseReduction ?? null,
                transcription: config.inputAudioTranscription,
                turnDetection: config.turnDetection,
            },
            output: {
                format: normalizeAudioFormat(config.outputAudioFormat),
                voice: config.voice,
                speed: config.speed,
            },
        },
    };
}
function normalizeAudioFormat(format) {
    if (!format)
        return undefined;
    if (typeof format === 'object')
        return format;
    const f = String(format);
    if (f === 'pcm16')
        return { type: 'audio/pcm', rate: 24000 };
    if (f === 'g711_ulaw')
        return { type: 'audio/pcmu' };
    if (f === 'g711_alaw')
        return { type: 'audio/pcma' };
    // Default fallback: assume 24kHz PCM if unknown string
    return { type: 'audio/pcm', rate: 24000 };
}
//# sourceMappingURL=clientMessages.js.map