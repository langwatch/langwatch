import * as React from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { auth } from '@/auth'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  IconGitHub,
  IconNextChat,
  IconSeparator,
  IconVercel
} from '@/components/ui/icons'
import { UserMenu } from '@/components/user-menu'
import { SidebarMobile } from './sidebar-mobile'
import { SidebarToggle } from './sidebar-toggle'
import { ChatHistory } from './chat-history'
import { Session } from '@/lib/types'

async function UserOrLogin() {
  const session = (await auth()) as Session
  return (
    <>
      {session?.user ? (
        <>
          <SidebarMobile>
            <ChatHistory userId={session.user.id} />
          </SidebarMobile>
          <SidebarToggle />
        </>
      ) : (
        <Link href="/new" rel="nofollow">
          <IconNextChat className="size-6 mr-2 dark:hidden" inverted />
          <IconNextChat className="hidden size-6 mr-2 dark:block" />
        </Link>
      )}
      <div className="flex items-center">
        <IconSeparator className="size-6 text-muted-foreground/50" />
        {session?.user ? (
          <UserMenu user={session.user} />
        ) : (
          <Button variant="plain" asChild className="-ml-2">
            <Link href="/login">Login</Link>
          </Button>
        )}
      </div>
    </>
  )
}

function LogoIcon({ width, height }: { width: number; height: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      fill="none"
      viewBox="0 0 38 52"
    >
      <path
        fill="#fff"
        d="M0 12.383v28.652c0 .357.19.688.5.866l16.595 9.58a.993.993 0 001 0l19.184-11.072a1 1 0 00.5-.866V10.887a.998.998 0 00-.5-.866l-6.111-3.526a.999.999 0 00-.999 0l-2.874 1.659V4.837a.998.998 0 00-.5-.866L20.684.442a1.003 1.003 0 00-1 0l-5.903 3.409a1 1 0 00-.5.866v7.44l-.36.208v-.493a1 1 0 00-.5-.866L7.405 8.107a1.005 1.005 0 00-1 0l-5.904 3.41a.998.998 0 00-.501.866z"
      ></path>
      <path
        fill="#213B41"
        d="M0 12.383v28.652c0 .357.19.688.5.866l16.595 9.58a.993.993 0 001 0l19.184-11.072a1 1 0 00.5-.866V10.887a.998.998 0 00-.5-.866l-6.111-3.526a.999.999 0 00-.999 0l-2.874 1.659V4.837a.998.998 0 00-.5-.866L20.684.442a1.003 1.003 0 00-1 0l-5.903 3.409a1 1 0 00-.5.866v7.44l-.36.208v-.493a1 1 0 00-.5-.866L7.405 8.107a1.005 1.005 0 00-1 0l-5.904 3.41a.998.998 0 00-.501.866zm1.5.865l4.019 2.318v7.728c0 .01.005.019.006.029a.363.363 0 00.009.065.46.46 0 00.043.128c.005.009.004.019.01.028.004.007.013.01.017.017a.464.464 0 00.12.125c.017.012.027.03.046.041l5.466 3.159c.007.004.016.002.024.006.068.035.142.06.224.06a.49.49 0 00.225-.059c.019-.01.034-.023.052-.035a.503.503 0 00.129-.127c.008-.012.021-.016.029-.029.005-.009.005-.02.01-.028.015-.03.022-.061.031-.094.009-.033.018-.065.02-.099 0-.01.006-.019.006-.029v-7.15l5.11 2.949v27.498L1.5 40.747V13.248zm34.278-2.361l-4.899 2.831-5.111-2.952.776-.449 4.124-2.38 5.11 2.95zM25.293 4.836l-4.902 2.829-5.11-2.949 4.902-2.832 5.11 2.952zM10.92 11.872l-4.901 2.829-4.018-2.318 4.903-2.832 4.016 2.321zm10.036 4.638l3.312-1.909v4.187c0 .021.01.039.012.06a.384.384 0 00.062.186c.016.027.031.054.053.078.022.026.049.047.076.068.018.013.028.03.047.041l5.36 3.093-5.88 3.394v-7.151c0-.01-.005-.019-.006-.029a.48.48 0 00-.051-.192c-.005-.009-.004-.02-.01-.028-.006-.009-.014-.014-.02-.022a.512.512 0 00-.142-.142c-.009-.006-.013-.015-.022-.02l-2.791-1.614zm4.312-4.877l5.111 2.952v6.863l-5.111-2.949v-6.866zm-12.782 6.804l4.903-2.833 5.109 2.952-4.903 2.829-5.109-2.948zm-1.501 7.15l-3.966-2.292 3.966-2.29v4.582zm1.435-11.202l1.86-1.074 2.542 1.466-4.402 2.543v-2.935zm2.36-8.803l5.111 2.949v6.863l-5.111-2.949V5.582z"
      ></path>
    </svg>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between w-full h-16 px-4 border-b shrink-0 bg-gradient-to-b from-background/10 via-background/50 to-background/80 backdrop-blur-xl">
      <div className="flex items-center">
        <LogoIcon width={19} height={26} />
        <IconSeparator className="size-6 text-muted-foreground/50 ml-3" />
        <Button variant="plain" asChild className="-ml-2">
          <Link href="/">Vercel AI SDK</Link>
        </Button>
        <IconSeparator className="size-6 text-muted-foreground/50" />
        <Button variant="plain" asChild className="-ml-2">
          <Link href="/langchain">LangChain.js</Link>
        </Button>
        <IconSeparator className="size-6 text-muted-foreground/50" />
        <Button variant="plain" asChild className="-ml-2">
          <Link href="/langchain-rag">LangChain.js RAG</Link>
        </Button>
        <IconSeparator className="size-6 text-muted-foreground/50" />
        <Button variant="plain" asChild className="-ml-2">
          <Link href="/guardrails">Guardrails</Link>
        </Button>
        <IconSeparator className="size-6 text-muted-foreground/50" />
        <Button variant="plain" asChild className="-ml-2">
          <Link href="/manual">Manual Tracing</Link>
        </Button>
        <IconSeparator className="size-6 text-muted-foreground/50" />
        <Button variant="plain" asChild className="-ml-2">
          <Link href="/late-update">Late Update Tracing</Link>
        </Button>
      </div>
      <div className="flex items-center justify-end space-x-2">
        <a
          target="_blank"
          href="https://github.com/langwatch/langwatch"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          <IconGitHub />
          <span className="hidden ml-2 md:flex">GitHub</span>
        </a>
      </div>
    </header>
  )
}
