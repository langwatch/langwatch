import { nanoid } from '@/lib/utils'
import { Chat } from '@/components/chat'
import { AI } from '@/lib/chat/vercel-ai'
import { auth } from '@/auth'
import { Session } from '@/lib/types'
import { getMissingKeys } from '@/app/actions'
import { Guardrails } from '../../lib/chat/guardrails'

export const metadata = {
  title: 'Guardrails Example'
}

export default async function IndexPage() {
  const id = nanoid()
  const session = (await auth()) as Session
  const missingKeys = await getMissingKeys()

  return (
    <>
      <div className="text-center w-full absolute pt-1">Guardrails Example</div>
      <Guardrails initialAIState={{ chatId: id, messages: [] }}>
        <Chat id={id} session={session} missingKeys={missingKeys} />
      </Guardrails>
    </>
  )
}
