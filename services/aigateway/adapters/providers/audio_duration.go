package providers

import (
	"bytes"
	"encoding/binary"
)

// Duration of an uploaded audio file, read from the file itself. It prices a
// streamed transcription whose final event never arrived, which is the only
// event that states what the provider measured.

// uploadedAudioFallbackBitsPerSecond prices a container this file cannot read
// (WebM, or anything unrecognized) from its size alone. The result is off by
// the ratio between the real bitrate and this one.
const uploadedAudioFallbackBitsPerSecond = 64_000

// uploadedAudioSeconds measures an upload. WAV, FLAC, Ogg and MP4 state their
// length and are exact; MP3 is exact with a Xing header or a constant bitrate
// and approximate for headerless VBR; the rest is the size-based estimate.
func uploadedAudioSeconds(file []byte) float64 {
	for _, measure := range []func([]byte) (float64, bool){
		wavSeconds, flacSeconds, oggSeconds, mp4Seconds, mp3Seconds,
	} {
		if seconds, ok := measure(file); ok && seconds > 0 {
			return seconds
		}
	}
	return float64(len(file)) * 8 / uploadedAudioFallbackBitsPerSecond
}

// wavSeconds divides the data chunk by the byte rate the fmt chunk states.
func wavSeconds(b []byte) (float64, bool) {
	if len(b) < 12 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return 0, false
	}
	format, ok := riffChunk(b, "fmt ")
	if !ok || len(format) < 12 {
		return 0, false
	}
	byteRate := binary.LittleEndian.Uint32(format[8:12])
	data, ok := riffChunk(b, "data")
	if !ok || byteRate == 0 {
		return 0, false
	}
	return float64(len(data)) / float64(byteRate), true
}

// riffChunk returns the payload of the first chunk with this id. A streamed
// WAV writes 0 or 0xFFFFFFFF as its data size, so a size that is absent or
// runs past the file is bounded by what was actually uploaded.
func riffChunk(b []byte, id string) ([]byte, bool) {
	for off := 12; off+8 <= len(b); {
		kind := string(b[off : off+4])
		size := int(binary.LittleEndian.Uint32(b[off+4 : off+8]))
		body := off + 8
		end := body + size
		if end > len(b) || (size == 0 && kind == "data") {
			end = len(b)
		}
		if kind == id {
			return b[body:end], true
		}
		off = end + size%2
	}
	return nil, false
}

// flacSeconds reads the sample rate and total samples from STREAMINFO.
func flacSeconds(b []byte) (float64, bool) {
	if len(b) < 26 || string(b[0:4]) != "fLaC" || b[4]&0x7f != 0 {
		return 0, false
	}
	info := b[8:26]
	rate := uint32(info[10])<<12 | uint32(info[11])<<4 | uint32(info[12])>>4
	samples := uint64(info[13]&0x0f)<<32 | uint64(binary.BigEndian.Uint32(info[14:18]))
	if rate == 0 || samples == 0 {
		return 0, false
	}
	return float64(samples) / float64(rate), true
}

// oggSeconds reads the granule position of the last page. Opus counts it at
// 48 kHz whatever the input rate; Vorbis counts it at its own sample rate.
func oggSeconds(b []byte) (float64, bool) {
	if len(b) < 58 || string(b[0:4]) != "OggS" {
		return 0, false
	}
	rate := 0.0
	head := b[:min(len(b), 4096)]
	if bytes.Contains(head, []byte("OpusHead")) {
		rate = 48000
	} else if i := bytes.Index(head, []byte("\x01vorbis")); i >= 0 && i+16 <= len(head) {
		rate = float64(binary.LittleEndian.Uint32(head[i+12 : i+16]))
	}
	last := bytes.LastIndex(b, []byte("OggS"))
	if rate == 0 || last < 0 || last+14 > len(b) {
		return 0, false
	}
	granule := binary.LittleEndian.Uint64(b[last+6 : last+14])
	if granule == 0 || granule == ^uint64(0) {
		return 0, false
	}
	return float64(granule) / rate, true
}

// mp4Seconds reads the movie header (moov/mvhd) of an MP4 or M4A file.
func mp4Seconds(b []byte) (float64, bool) {
	if len(b) < 12 || string(b[4:8]) != "ftyp" {
		return 0, false
	}
	moov, ok := mp4Box(b, "moov")
	if !ok {
		return 0, false
	}
	mvhd, ok := mp4Box(moov, "mvhd")
	if !ok {
		return 0, false
	}
	scale, length := mvhdTiming(mvhd)
	if scale == 0 || length == 0 {
		return 0, false
	}
	return float64(length) / float64(scale), true
}

// mvhdTiming reads the timescale and duration, which version 1 of the box
// stores as 64-bit times and version 0 as 32-bit ones.
func mvhdTiming(mvhd []byte) (scale uint32, length uint64) {
	switch {
	case len(mvhd) >= 32 && mvhd[0] == 1:
		return binary.BigEndian.Uint32(mvhd[20:24]), binary.BigEndian.Uint64(mvhd[24:32])
	case len(mvhd) >= 20 && mvhd[0] != 1:
		return binary.BigEndian.Uint32(mvhd[12:16]), uint64(binary.BigEndian.Uint32(mvhd[16:20]))
	default:
		return 0, 0
	}
}

// mp4Box returns the payload of the first box of this type at one level.
func mp4Box(b []byte, kind string) ([]byte, bool) {
	for off := 0; off+8 <= len(b); {
		size, header := mp4BoxSize(b[off:])
		if size < header || off+size > len(b) {
			return nil, false
		}
		if string(b[off+4:off+8]) == kind {
			return b[off+header : off+size], true
		}
		off += size
	}
	return nil, false
}

// mp4BoxSize reads a box's total size and header length. Size 1 means a
// 64-bit size follows the type; size 0 means the box runs to the end.
func mp4BoxSize(box []byte) (size, header int) {
	size, header = int(binary.BigEndian.Uint32(box[0:4])), 8
	if size == 1 && len(box) >= 16 {
		return int(binary.BigEndian.Uint64(box[8:16])), 16
	}
	if size == 0 {
		size = len(box)
	}
	return size, header
}

var (
	mp3BitratesV1L3 = [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0}
	mp3BitratesV2L3 = [16]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0}
	mp3SampleRates  = [4]int{44100, 48000, 32000, 0}
)

// mp3Seconds reads the first Layer III frame: the Xing frame count when the
// encoder wrote one, the frame's own bitrate over the file size otherwise.
func mp3Seconds(b []byte) (float64, bool) {
	start := 0
	if len(b) >= 10 && string(b[0:3]) == "ID3" {
		start = 10 + (int(b[6]&0x7f)<<21 | int(b[7]&0x7f)<<14 | int(b[8]&0x7f)<<7 | int(b[9]&0x7f))
	}
	for off := start; off+4 <= len(b) && off < start+8192; off++ {
		frame, ok := mp3FrameHeader(b[off : off+4])
		if !ok {
			continue
		}
		if frames, ok := xingFrames(b[off:min(len(b), off+256)]); ok {
			return float64(frames) * float64(frame.samples) / float64(frame.rate), true
		}
		return float64(len(b)-off) * 8 / float64(frame.kbps*1000), true
	}
	return 0, false
}

// mp3Frame is what one Layer III frame header states.
type mp3Frame struct {
	kbps    int
	rate    int
	samples int
}

// mp3FrameHeader decodes four bytes as a Layer III frame header, and reports
// false when they are not one.
func mp3FrameHeader(h []byte) (mp3Frame, bool) {
	if h[0] != 0xff || h[1]&0xe0 != 0xe0 {
		return mp3Frame{}, false
	}
	version := (h[1] >> 3) & 0x03 // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
	layer := (h[1] >> 1) & 0x03   // 1 = Layer III
	rate := mp3SampleRates[(h[2]>>2)&0x03]
	if version == 1 || layer != 1 || rate == 0 {
		return mp3Frame{}, false
	}
	frame := mp3Frame{kbps: mp3BitratesV1L3[h[2]>>4], rate: rate, samples: 1152}
	switch version {
	case 2:
		frame = mp3Frame{kbps: mp3BitratesV2L3[h[2]>>4], rate: rate / 2, samples: 576}
	case 0:
		frame = mp3Frame{kbps: mp3BitratesV2L3[h[2]>>4], rate: rate / 4, samples: 576}
	}
	return frame, frame.kbps != 0
}

// xingFrames reads the frame count a VBR (Xing) or CBR (Info) header states.
func xingFrames(frame []byte) (uint32, bool) {
	for _, tag := range []string{"Xing", "Info"} {
		i := bytes.Index(frame, []byte(tag))
		if i < 0 || i+12 > len(frame) {
			continue
		}
		if binary.BigEndian.Uint32(frame[i+4:i+8])&0x01 == 0 {
			return 0, false
		}
		return binary.BigEndian.Uint32(frame[i+8 : i+12]), true
	}
	return 0, false
}
