import 'server-only'

import {
  createAI,
  createStreamableValue,
  getMutableAIState,
  type MutableAIState
} from 'ai/rsc'

import { BotMessage } from '@/components/stocks'

import { Message } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { ChatOpenAI } from '@langchain/openai'
import { LangWatch, type LangWatchTrace } from 'langwatch'

async function submitUserMessage(message: string) {
  'use server'

  const langwatch = new LangWatch()
  langwatch.on('error', e => {
    console.log('Error from LangWatch:', e)
  })

  const trace = langwatch.getTrace()

  const aiState = getMutableAIState<typeof Guardrails>()
  const textStream = createStreamableValue('')
  const textNode = <BotMessage content={textStream.value} />

  void llmStep({ message, trace, aiState, textStream })

  return {
    id: nanoid(),
    display: textNode
  }
}

async function llmStep({
  message,
  trace,
  aiState,
  textStream
}: {
  message: string
  trace: LangWatchTrace
  aiState: MutableAIState<AIState>
  textStream: ReturnType<typeof createStreamableValue>
}) {
  'use server'

  textStream.update('Running Jailbreak guardrail...\n\n')

  const jailbreakPromise = trace.evaluate({
    evaluator: 'azure/jailbreak',
    name: 'Jailbreak Detection',
    input: message,
    settings: {},
    asGuardrail: true
  })

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', 'Translate the following from English into Italian'],
    ['human', '{input}']
  ])
  const model = new ChatOpenAI({ model: 'gpt-4o-mini' })
  const outputParser = new StringOutputParser()

  const chain = prompt.pipe(model).pipe(outputParser)

  const chainPromise = chain.invoke(
    { input: message },
    { callbacks: [trace.getLangChainCallback()] }
  )

  const [jailbreakResult, result] = await Promise.all([
    jailbreakPromise,
    chainPromise
  ])

  if (!jailbreakResult.passed) {
    textStream.update('Jailbreak detected, stopping execution.')
    textStream.done()
    aiState.done()
    return
  }

  aiState.update({
    ...aiState.get(),
    messages: [
      {
        id: nanoid(),
        role: 'system',
        content: 'Translate the following from English into Italian'
      },
      {
        id: nanoid(),
        role: 'user',
        content: message
      }
    ]
  })

  textStream.update('Running Moderation guardrail...\n\n')

  const moderationGuardrail = await trace.evaluate({
    evaluator: 'openai/moderation',
    asGuardrail: true,
    name: 'Moderation',
    input: message,
    output: result, // optional
    settings: {
      model: 'text-moderation-stable',
      categories: {
        harassment: true,
        harassment_threatening: true,
        hate: true,
        hate_threatening: true,
        self_harm: true,
        self_harm_instructions: true,
        self_harm_intent: true,
        sexual: true,
        sexual_minors: true,
        violence: true,
        violence_graphic: true
      }
    }
  })

  if (!moderationGuardrail.passed) {
    textStream.update('Moderation failed, stopping execution.')
    textStream.done()
    aiState.done()
    return
  }

  textStream.update(result)
  textStream.done()

  aiState.done({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'assistant',
        content: result
      }
    ]
  })
}

export type AIState = {
  chatId: string
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
}[]

export const Guardrails = createAI<AIState, UIState>({
  actions: {
    submitUserMessage
  },
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
  onGetUIState: async () => {
    'use server'

    return undefined
  },
  onSetAIState: async ({ state }) => {
    'use server'

    return
  }
})
