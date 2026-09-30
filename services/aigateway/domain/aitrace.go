package domain

import "github.com/langwatch/langwatch/pkg/aitrace"

// The customer trace bridge in pkg reads these, and pkg imports nothing from
// services, so they are defined in pkg/aitrace and aliased here.
type (
	ProviderID      = aitrace.ProviderID
	RequestType     = aitrace.RequestType
	Usage           = aitrace.Usage
	AudioTokenSplit = aitrace.AudioTokenSplit
	ImageTokenSplit = aitrace.ImageTokenSplit
	AITraceParams   = aitrace.AITraceParams
)

const (
	ProviderOpenAI      = aitrace.ProviderOpenAI
	ProviderAnthropic   = aitrace.ProviderAnthropic
	ProviderAzure       = aitrace.ProviderAzure
	ProviderBedrock     = aitrace.ProviderBedrock
	ProviderVertex      = aitrace.ProviderVertex
	ProviderGemini      = aitrace.ProviderGemini
	ProviderXAI         = aitrace.ProviderXAI
	ProviderGroq        = aitrace.ProviderGroq
	ProviderCerebras    = aitrace.ProviderCerebras
	ProviderDeepSeek    = aitrace.ProviderDeepSeek
	ProviderVoyage      = aitrace.ProviderVoyage
	ProviderCustom      = aitrace.ProviderCustom
	ProviderElevenLabs  = aitrace.ProviderElevenLabs
	ProviderLangWatch   = aitrace.ProviderLangWatch
	ProviderOpenAICodex = aitrace.ProviderOpenAICodex
)

const (
	RequestTypeChat            = aitrace.RequestTypeChat
	RequestTypeMessages        = aitrace.RequestTypeMessages
	RequestTypeEmbeddings      = aitrace.RequestTypeEmbeddings
	RequestTypeResponses       = aitrace.RequestTypeResponses
	RequestTypePassthrough     = aitrace.RequestTypePassthrough
	RequestTypeSpeech          = aitrace.RequestTypeSpeech
	RequestTypeTranscription   = aitrace.RequestTypeTranscription
	RequestTypeImageGeneration = aitrace.RequestTypeImageGeneration
	RequestTypeImageEdit       = aitrace.RequestTypeImageEdit
	RequestTypeRealtimeSession = aitrace.RequestTypeRealtimeSession
)
