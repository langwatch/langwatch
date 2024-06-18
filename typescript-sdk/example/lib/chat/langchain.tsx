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
import { ChatPromptTemplate } from '@langchain/core/prompts'
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage
} from '@langchain/core/messages'
import { StringOutputParser } from '@langchain/core/output_parsers'

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
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content: message
      }
    ]
  })

  // const span = trace.startLLMSpan({
  //   model: 'gpt-3.5-turbo',
  //   input: {
  //     type: 'chat_messages',
  //     value: [
  //       {
  //         role: 'system',
  //         content: system
  //       },
  //       ...convertFromVercelAIMessages(aiState.get().messages)
  //     ]
  //   }
  // })

  //   // span.end({
  //   //   output: {
  //   //     type: 'chat_messages',
  //   //     value: convertFromVercelAIMessages(output)
  //   //   }
  //   // })
  // }

  const messages = [
    new SystemMessage('Translate the following from English into Italian'),
    ...aiState.get().messages.map(message => {
      if (message.role === 'system') {
        return new SystemMessage(message.content)
      }
      if (message.role === 'user') {
        return new HumanMessage(message.content.toString())
      }
      if (message.role === 'tool') {
        return new ToolMessage({
          content: message.content,
          tool_call_id: message.content[0]!.toolCallId
        })
      }
      return new AIMessage(message.content.toString())
    })
  ]

  const prompt = ChatPromptTemplate.fromMessages(messages)
  const model = new ChatOpenAI({ model: 'gpt-3.5-turbo' })
  const outputParser = new StringOutputParser()

  const chain = prompt.pipe(model).pipe(outputParser)

  const stream = await chain.stream(
    {},
    {
      callbacks: [trace.getLangChainCallback()]
    }
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
