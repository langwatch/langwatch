package app

// SilentWavBase64 is a 44-byte silent 8-bit PCM WAV (RIFF header + zero
// data bytes). Deterministic and small enough to inline. Recognisable as
// `audio/wav` by every common parser without us shipping a binary asset.
const SilentWavBase64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="

// AudioFormat is the wav variant noai always responds with. Real audio
// LLMs let the caller pick mp3/flac/etc; the fake server keeps things
// trivial and the silent stub identical across requests.
const AudioFormat = "wav"
