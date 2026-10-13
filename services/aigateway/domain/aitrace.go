package domain

import "github.com/langwatch/langwatch/pkg/aitrace"

// The customer trace bridge in pkg reads these, and pkg imports nothing from
// services, so they are defined in pkg/aitrace and aliased here.
type (
	// ProviderID is aitrace.ProviderID.
	ProviderID = aitrace.ProviderID
	// RequestType is aitrace.RequestType.
	RequestType = aitrace.RequestType
	// Usage is aitrace.Usage.
	Usage = aitrace.Usage
	// AudioTokenSplit is aitrace.AudioTokenSplit.
	AudioTokenSplit = aitrace.AudioTokenSplit
	// ImageTokenSplit is aitrace.ImageTokenSplit.
	ImageTokenSplit = aitrace.ImageTokenSplit
	// AITraceParams is aitrace.Params.
	AITraceParams = aitrace.Params
)

// The provider identifiers, aliased from pkg/aitrace.
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

// The request types, aliased from pkg/aitrace.
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
