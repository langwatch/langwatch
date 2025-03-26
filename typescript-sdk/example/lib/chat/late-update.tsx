import 'server-only'

import { openai } from '@ai-sdk/openai'
import {
  createAI,
  createStreamableValue,
  getAIState,
  getMutableAIState,
  streamUI
} from 'ai/rsc'

import { BotMessage } from '@/components/stocks'

import { saveChat } from '@/app/actions'
import { auth } from '@/auth'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Chat, Message } from '@/lib/types'
import { nanoid } from '@/lib/utils'
import { LangWatch, convertFromVercelAIMessages } from 'langwatch'

async function submitUserMessage(content: string) {
  'use server'

  const langwatch = new LangWatch()
  langwatch.on('error', e => {
    console.log('Error from LangWatch:', e)
  })

  const trace = langwatch.getTrace()

  const aiState = getMutableAIState<typeof LateUpdateTracing>()

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content
      }
    ]
  })

  const system = "You are a helpful assistant."

  const span = trace.startLLMSpan({
    model: 'gpt-4o-mini',
    input: {
      type: 'chat_messages',
      value: [
        {
          role: 'system',
          content: system
        },
        ...convertFromVercelAIMessages(aiState.get().messages)
      ]
    }
  })

  const onFinish = (output: Message[]) => {
    aiState.done({
      ...aiState.get(),
      messages: [...aiState.get().messages, ...output]
    })

    span.end({
      output: {
        type: 'chat_messages',
        value: convertFromVercelAIMessages(output)
      }
    })

    setTimeout(() => {
      span.end({
        params: {
          late_update_at: (new Date()).toISOString()
        }
      })
    }, 5000);
  }

  let textStream: undefined | ReturnType<typeof createStreamableValue<string>>
  let textNode: undefined | React.ReactNode

  const result = await streamUI({
    model: openai('gpt-4o-mini'),
    initial: <SpinnerMessage />,
    system,
    messages: [
      ...aiState.get().messages.map((message: any) => ({
        role: message.role,
        content: message.content,
        name: message.name
      }))
    ],
    text: ({ content, done, delta }) => {
      if (!textStream) {
        textStream = createStreamableValue('')
        textNode = <BotMessage content={textStream.value} />
      }

      if (done) {
        textStream.done()

        onFinish([
          {
            id: nanoid(),
            role: 'assistant',
            content
          }
        ])
      } else {
        textStream.update(delta)
      }

      return textNode
    }
  })

  return {
    id: nanoid(),
    display: result.value
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

export const LateUpdateTracing = createAI<AIState, UIState>({
  actions: {
    submitUserMessage
  },
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
  onGetUIState: async () => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const aiState = getAIState()

      if (aiState) {
        // @ts-ignore
        const uiState = getUIStateFromAIState(aiState)
        return uiState
      }
    } else {
      return
    }
  },
  onSetAIState: async ({ state }) => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const { chatId, messages } = state

      const createdAt = new Date()
      const userId = session.user.id as string
      const path = `/chat/${chatId}`

      const firstMessageContent = messages[0].content as string
      const title = firstMessageContent.substring(0, 100)

      const chat: Chat = {
        id: chatId,
        title,
        userId,
        createdAt,
        messages,
        path
      }

      await saveChat(chat)
    } else {
      return
    }
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'tool' ? (
          message.content.map(tool => {
            return `Tool used: ${tool.toolName}`
          })
        ) : message.role === 'user' ? (
          <UserMessage>{message.content as string}</UserMessage>
        ) : message.role === 'assistant' &&
          typeof message.content === 'string' ? (
          <BotMessage content={message.content} />
        ) : null
    }))
}
