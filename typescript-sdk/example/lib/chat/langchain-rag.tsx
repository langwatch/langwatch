import 'server-only'

import { openai } from '@ai-sdk/openai'
import {
  createAI,
  createStreamableUI,
  createStreamableValue,
  getMutableAIState,
  streamUI
} from 'ai/rsc'

import { BotCard, BotMessage, Purchase, Stock } from '@/components/stocks'

import { Events } from '@/components/stocks/events'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Stocks } from '@/components/stocks/stocks'
import { Chat, Message } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { LangWatch, convertFromVercelAIMessages } from 'langwatch'
import { ChatOpenAI } from '@langchain/openai'
import {
  ChatPromptTemplate,
  PromptTemplateInput
} from '@langchain/core/prompts'
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
  BaseMessageLike
} from '@langchain/core/messages'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { CallbackManagerForRetrieverRun } from '@langchain/core/callbacks/manager'
import {
  BaseRetriever,
  type BaseRetrieverInput
} from '@langchain/core/retrievers'
import { Document } from '@langchain/core/documents'
import {
  RunnableLambda,
  RunnableMap,
  RunnablePassthrough
} from '@langchain/core/runnables'

async function submitUserMessage(message: string) {
  'use server'

  const langwatch = new LangWatch()
  langwatch.on('error', e => {
    console.log('Error from LangWatch:', e)
  })

  const trace = langwatch.getTrace()

  const aiState = getMutableAIState<typeof LangChainRAGAI>()

  const messages: BaseMessageLike[] = [
    ['system', 'Answer based on the retrieved context'],
    ...(aiState.get().messages.map(message => {
      if (message.role === 'system') {
        return ['system', message.content.toString()]
      }
      if (message.role === 'user') {
        return ['human', message.content.toString()]
      }
      if (message.role === 'tool') {
        return ['tool', message.content.toString()]
      }
      return ['ai', message.content.toString()]
    }) as BaseMessageLike[]),
    ['ai', 'Retrieved the following context: {context}'],
    ['human', '{question}']
  ]

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content: message
      }
    ]
  })

  const prompt = ChatPromptTemplate.fromMessages(messages)
  const model = new ChatOpenAI({ model: 'gpt-4o-mini' })
  const retriever = new CustomRetriever()
  const outputParser = new StringOutputParser()

  const setupAndRetrieval = RunnableMap.from({
    context: new RunnableLambda({
      func: (input: string) =>
        retriever
          .invoke(input, {
            callbacks: [trace.getLangChainCallback()]
          })
          .then(response => response[0].pageContent)
    }).withConfig({ runName: 'contextRetriever' }),
    question: new RunnablePassthrough()
  })

  const chain = setupAndRetrieval.pipe(prompt).pipe(model).pipe(outputParser)

  const stream = await chain.stream(message, {
    callbacks: [trace.getLangChainCallback()]
  })

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

export const LangChainRAGAI = createAI<AIState, UIState>({
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

export class CustomRetriever extends BaseRetriever {
  lc_namespace = ['langchain', 'retrievers']

  constructor(fields?: BaseRetrieverInput) {
    super(fields)
  }

  async _getRelevantDocuments(
    query: string,
    _runManager?: CallbackManagerForRetrieverRun
  ): Promise<Document[]> {
    console.log('query', query)
    return [
      new Document({
        pageContent: `Some document pertaining to ${query}`,
        metadata: {}
      }),
      new Document({
        pageContent: `Some other document pertaining to ${query}`,
        metadata: {}
      })
    ]
  }
}
