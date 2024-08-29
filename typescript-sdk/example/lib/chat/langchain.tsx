import 'server-only'

import { createAI, createStreamableValue, getMutableAIState } from 'ai/rsc'

import { BotMessage } from '@/components/stocks'

import { Message } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { ChatOpenAI } from '@langchain/openai'
import { LangWatch } from 'langwatch'

async function submitUserMessage(message: string) {
  'use server'

  const langwatch = new LangWatch()
  langwatch.on('error', e => {
    console.log('Error from LangWatch:', e)
  })

  const trace = langwatch.getTrace()

  const aiState = getMutableAIState<typeof LangChainAI>()

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

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', 'Translate the following from English into Italian'],
    ['human', '{input}']
  ])
  const model = new ChatOpenAI({ model: 'gpt-4o-mini' })
  const outputParser = new StringOutputParser()

  const chain = prompt.pipe(model).pipe(outputParser)

  const stream = await chain.stream(
    { input: message },
    { callbacks: [trace.getLangChainCallback()] }
  )

  let textStream = createStreamableValue('')
  let textNode = <BotMessage content={textStream.value} />
  let content = ''

  setTimeout(async () => {
    for await (const chunk of stream) {
      textStream.update(chunk)
      content += chunk
    }

    textStream?.done()
    aiState.done({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: nanoid(),
          role: 'assistant',
          content
        }
      ]
    })
  }, 0)

  return {
    id: nanoid(),
    display: textNode
  }
}

export type AIState = {
  chatId: string
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
}[]

export const LangChainAI = createAI<AIState, UIState>({
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
